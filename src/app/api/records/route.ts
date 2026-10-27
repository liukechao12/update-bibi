import { NextResponse } from 'next/server';
import { isPublishTimeInFuture, mapRawRecordToPushRecord, normalizePublishTimeToDate } from '@/lib/mapping';
import { extractRawBlocks, findMissingFields, parseRawTextRecords } from '@/lib/raw-parser';
import { pushRecordsSaveSchema } from '@/lib/schemas';
import type { PushRecordInput } from '@/lib/schemas';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { MediaRuleType } from '@prisma/client';
import { classifyAuthorType, classifyPublisherType, getDomainFromUrl } from '@/lib/media-classification';
import { syncDailyCollectionEvents } from '@/lib/daily-event-sync';
import { scheduleScreenshots } from '@/lib/post-entry';
import { savePluginScreenshotForRecord } from '@/lib/image-service';
import { generateBatchNo } from '@/lib/business-no';

/**
 * 插件自带截图的 base64 长度上限。
 *
 * 首屏 PNG 一般几百 KB，base64 膨胀约 1.33 倍；放到 8MB 足够覆盖高分屏，
 * 又能挡住异常客户端塞超大字符串把 JSON 解析打爆。
 */
const PLUGIN_SCREENSHOT_MAX_BASE64 = 8 * 1024 * 1024;

function resolveMediaLibraryName(domain: string, authorName: string) {
  const labelMap: Record<string, string> = {
    'weibo.com': '微博',
    'xiaohongshu.com': '小红书',
    'douyin.com': '抖音',
    'zhihu.com': '知乎',
    'tieba.baidu.com': '百度贴吧',
    'mp.weixin.qq.com': '微信',
    'channels.weixin.qq.com': '微信视频号',
    'weixin.qq.com': '微信'
  };

  const domainLabel = labelMap[domain] ?? domain;
  return authorName ? `${domainLabel} - ${authorName}` : domainLabel;
}


export async function POST(request: Request) {
  const receivedAt = new Date();
  const auth = await requireApiUser(request);
  if ('error' in auth) return auth.error;
  const pluginSource = auth.pluginClientId
    ? { lastPluginClientId: auth.pluginClientId, lastPluginReceivedAt: receivedAt }
    : {};

  const body = await request.json().catch(() => ({}));
  const sourceText = String(body?.sourceText ?? '');
  const selectedTendency = String(body?.tendency ?? '').trim();

  // 插件（小红书抓取）在浏览器里截好首屏一起带过来；不带这个字段时行为完全不变，
  // 仍由入库后的 scheduleScreenshots 走 Browserless。
  const pluginScreenshotBase64 = typeof body?.screenshotBase64 === 'string' ? body.screenshotBase64.trim() : '';

  if (pluginScreenshotBase64 && pluginScreenshotBase64.length > PLUGIN_SCREENSHOT_MAX_BASE64) {
    return NextResponse.json(
      { code: 40002, message: `截图过大（超过 ${Math.round(PLUGIN_SCREENSHOT_MAX_BASE64 / 1024 / 1024)}MB），请重试` },
      { status: 400 }
    );
  }

  if (!sourceText.trim() && !Array.isArray(body?.records)) {
    return NextResponse.json({ code: 40002, message: '请输入 sourceText 或 records' }, { status: 400 });
  }

  const rawBlocks = sourceText.trim() ? extractRawBlocks(sourceText) : [];
  const missing = sourceText.trim() ? findMissingFields(sourceText) : [];
  const parsedRawRecords = sourceText.trim() ? parseRawTextRecords(sourceText) : [];
  const rawRecords = Array.isArray(body?.records)
    ? body.records.map((item: unknown, index: number) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      return { ...record, crawlTime: record.crawlTime === undefined ? parsedRawRecords[index]?.crawlTime ?? receivedAt.toISOString() : record.crawlTime };
    })
    : parsedRawRecords.map((item) => mapRawRecordToPushRecord({ ...item, crawlTime: item.crawlTime ?? receivedAt.toISOString() }));

  const batchCheck = pushRecordsSaveSchema.safeParse({ version: '3', records: rawRecords });
  const futureRows = parsedRawRecords.map((item, index) => ({ index, future: isPublishTimeInFuture(item.time, receivedAt) })).filter((item) => item.future);
  if (futureRows.length > 0) {
    return NextResponse.json({ code: 40005, message: '存在发布时间晚于当前时间的记录，请检查相对时间换算', futureRows }, { status: 422 });
  }
  if (!batchCheck.success) {
    return NextResponse.json(
      {
        code: 40002,
        message: batchCheck.error.issues[0]?.message ?? '请求体校验失败',
        missingFields: missing,
        rawBlocks
      },
      { status: 400 }
    );
  }

  // 整批 schema 通过后才进入业务分支，使用校验后的值并保留原始行号。
  const validRecords = batchCheck.data.records;
  const validTendencies: Array<string | null> = validRecords.map((_, index) =>
    parsedRawRecords[index]?.tendency || selectedTendency ||
    (Array.isArray(body?.records) ? String(rawRecords[index].tendency ?? '') || null : null)
  );

  const currentUser = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!currentUser) {
    return NextResponse.json({ code: 40400, message: '用户不存在' }, { status: 404 });
  }

  // 来源部门：优先取 auth.user.department（插件调用时已替换为 ExternalApiClient.department）
  const sourceDepartment = auth.user.department?.trim() || currentUser.department?.trim() || null;

  const missingForResponse = selectedTendency
    ? missing.map((item) => ({ ...item, missing: item.missing.filter((field) => field !== '倾向性') }))
    : missing;
  const hasMissing = missingForResponse.some((item) => item.missing.length > 0);

  if (!selectedTendency && parsedRawRecords.some((item) => !item.tendency?.trim())) {
    return NextResponse.json({
      code: 40004,
      message: '存在未填写倾向性的记录，请选择倾向性后继续',
      requiresTendency: true,
      missingFields: missingForResponse,
      rawBlocks
    }, { status: 422 });
  }

  // 按 textId 去重，保留原始行号用于回溯来源
  const seenTextIds = new Set<string>();
  const uniqueRecords: PushRecordInput[] = [];
  const uniqueTendencies: Array<string | null> = [];
  const uniqueSourceIndexes: number[] = [];
  for (let index = 0; index < validRecords.length; index += 1) {
    const record = validRecords[index];
    if (seenTextIds.has(record.textId)) continue;
    seenTextIds.add(record.textId);
    uniqueRecords.push(record);
    uniqueTendencies.push(validTendencies[index] ?? null);
    uniqueSourceIndexes.push(index);
  }

  const previewRecords = uniqueRecords.map((record, index) => ({
    ...record,
    tendency: (uniqueTendencies[index] ?? selectedTendency) || null
  }));

  // Auto-sync media library rules from unique (domain + author) pairs
  const uniqueDomainAuthors = new Set<string>();
  const domainAuthorToInfo = new Map<string, { domain: string; authorName: string; source: string; originType: 'media' | 'xhs' | 'wb' | 'wx' | 'sph' | 'dy' | 'zh' | 'tb' | 'other'; publisherType: 'MEDIA' | 'SOCIAL'; authorType: 'BLUE_V' | 'SELF_MEDIA' | 'PERSONAL' | null }>();
  for (let index = 0; index < uniqueRecords.length; index += 1) {
    const record = uniqueRecords[index];
    const parsed = parsedRawRecords[uniqueSourceIndexes[index]] ?? {};
    const domain = getDomainFromUrl(record.url);
    const authorName = record.author?.trim() || '';
    const source = String(parsed.source ?? '');
    const certType = parsed.certType == null ? '' : String(parsed.certType);
    const publisherType = classifyPublisherType({ source, author: authorName, url: record.url, originType: record.originType });
    const authorType = classifyAuthorType({
      certType,
      publisherType,
      source,
      author: authorName,
      url: record.url,
      originType: record.originType
    });
    if (domain && authorName) {
      const key = `${domain}||${authorName}`;
      uniqueDomainAuthors.add(key);
      domainAuthorToInfo.set(key, { domain, authorName, source, originType: record.originType, publisherType, authorType });
    }
  }

  for (const key of uniqueDomainAuthors) {
    const item = domainAuthorToInfo.get(key);
    if (!item) continue;
    const { domain, authorName, source, originType, publisherType, authorType } = item;
    const existing = await prisma.mediaLibrary.findFirst({
      where: { domain, authorName }
    });
    if (!existing) {
      await prisma.mediaLibrary.create({
        data: {
          name: resolveMediaLibraryName(domain, authorName),
          domain,
          authorName,
          originType: originType as never,
          publisherType: publisherType as never,
          authorType: authorType as never,
          ruleType: MediaRuleType.DOMAIN,
          rulePattern: `${domain}||${authorName}`,
          priority: 0,
          status: 'ACTIVE' as never,
          remark: `source=${source}`,
          createdById: currentUser.id
        }
      });
    }
  }

  const batch = await prisma.dataBatch.create({
    data: {
      batchNo: generateBatchNo(),
      importType: 'PASTE',
      sourceDepartment,
      totalCount: uniqueRecords.length,
      validCount: uniqueRecords.length,
      invalidCount: 0,
      createdById: currentUser.id,
      status: 'PENDING_PUSH',
      remark: sourceText.trim() ? '粘贴解析保存' : '接口保存'
    }
  });

  const savedRecords: Array<{ id: string; record: PushRecordInput; tendency: string | null; rowNo: number }> = [];
  const duplicateRecords: Array<{ index: number; textId: string }> = [];
  const updatedRecords: Array<{ index: number; textId: string }> = [];
  const blockedRecords: Array<{ index: number; textId: string; message: string }> = [];
  for (let index = 0; index < uniqueRecords.length; index += 1) {
    const record = uniqueRecords[index];
    const tendency = (uniqueTendencies[index] ?? selectedTendency) || null;
    const publishTime = normalizePublishTimeToDate(record.publishTime);
    const crawlTime = record.crawlTime ? new Date(record.crawlTime) : receivedAt;
    const sourceIndex = uniqueSourceIndexes[index];
    const sourceRow = rawRecords[sourceIndex] as Record<string, unknown> | undefined;
    const rawSourceText = JSON.stringify(sourceText.trim()
      ? { ...parsedRawRecords[sourceIndex], sourceText: rawBlocks[sourceIndex] }
      : body.records[sourceIndex]);
    const parsedSource = parsedRawRecords[sourceIndex]?.source;
    const bodySource = typeof sourceRow?.sourceName === 'string' ? sourceRow.sourceName : typeof sourceRow?.source === 'string' ? sourceRow.source : typeof sourceRow?.['来源'] === 'string' ? sourceRow['来源'] : '';
    const sourceName = (parsedSource ?? '').trim() || bodySource.trim() || null;
    const existing = await prisma.dataRecord.findFirst({
      where: {
        OR: [
          { textId: record.textId },
          { url: record.url }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    if (existing) {
      previewRecords[index].textId = existing.textId;
      const changed = existing.title !== record.title || existing.text !== record.text ||
        existing.publishTime.getTime() !== publishTime.getTime() || existing.author !== record.author ||
        existing.originType !== record.originType || existing.publisherType !== record.publisherType ||
        existing.authorType !== record.authorType || existing.url !== record.url ||
        existing.commentNum !== record.commentNum || existing.forwardNum !== record.forwardNum ||
        existing.praiseNum !== record.praiseNum || existing.viewNum !== record.viewNum ||
        existing.tendency !== tendency || existing.sourceName !== sourceName;

      if (!changed) {
        if (auth.pluginClientId) {
          await prisma.dataRecord.updateMany({
            where: { id: existing.id, OR: [{ lastPluginReceivedAt: null }, { lastPluginReceivedAt: { lte: receivedAt } }] },
            data: pluginSource
          });
        }
        duplicateRecords.push({ index, textId: existing.textId });
        continue;
      }

      // 写入时再次检查状态，避免查询后开始推送的记录被覆盖；不修复历史悬挂任务。
      const updated = await prisma.dataRecord.updateMany({
        where: {
          id: existing.id,
          recordStatus: { not: 'PUSHING' },
          pushItems: { none: { OR: [
            { status: { in: ['SENDING', 'RETRYING'] } },
            { pushJob: { status: { in: ['SENDING', 'RETRYING'] } } }
          ] } }
        },
        data: {
          title: record.title,
          text: record.text,
          publishTime,
          crawlTime,
          author: record.author,
          originType: record.originType,
          publisherType: record.publisherType,
          authorType: record.authorType,
          url: record.url,
          commentNum: record.commentNum,
          forwardNum: record.forwardNum,
          praiseNum: record.praiseNum,
          viewNum: record.viewNum,
          tendency,
          sourceDepartment,
          ...pluginSource,
          recordStatus: 'PENDING_PUSH',
          rawSourceText,
          sourceName,
          sourceRowNo: sourceIndex + 1
        }
      });
      if (updated.count === 0) {
        blockedRecords.push({ index: sourceIndex, textId: existing.textId, message: '记录正在推送，禁止覆盖在途内容，请稍后重试' });
        continue;
      }
      updatedRecords.push({ index, textId: existing.textId });
      savedRecords.push({ id: existing.id, record: { ...record, textId: existing.textId }, tendency, rowNo: sourceIndex + 1 });
      continue;
    }

    const saved = await prisma.dataRecord.create({
      data: {
        batchId: batch.id,
        textId: record.textId,
        title: record.title,
        text: record.text,
        publishTime,
        crawlTime,
        author: record.author,
        originType: record.originType,
        publisherType: record.publisherType,
        authorType: record.authorType,
        url: record.url,
        commentNum: record.commentNum,
        forwardNum: record.forwardNum,
        praiseNum: record.praiseNum,
        viewNum: record.viewNum,
        tendency,
        sourceDepartment,
        ...pluginSource,
        recordStatus: 'PENDING_PUSH',
        createdById: currentUser.id,
        rawSourceText,
        sourceName,
        sourceRowNo: sourceIndex + 1
      }
    });
    previewRecords[index].textId = saved.textId;
    savedRecords.push({ id: saved.id, record: { ...record, textId: saved.textId }, tendency, rowNo: sourceIndex + 1 });
  }

  await prisma.dataBatch.update({
    where: { id: batch.id },
    data: {
      validCount: savedRecords.length,
      invalidCount: uniqueRecords.length - savedRecords.length,
      remark: `${sourceText.trim() ? '粘贴解析保存' : '接口保存'}，新增 ${savedRecords.length - updatedRecords.length} 条，更新 ${updatedRecords.length} 条，跳过未变化 ${duplicateRecords.length} 条，推送中禁止覆盖 ${blockedRecords.length} 条`
    }
  });

  const eventSync = await syncDailyCollectionEvents(savedRecords.map(({ record, tendency, rowNo }) => ({ record, tendency, rowNo })));

  // 插件自带截图时：同步存图后再返回。
  // 必须 await —— 插件路由拿到 savedRecordIds 后会立刻推送，
  // 推送阶段是按「有没有已上传的图」决定走 v4 还是降级 v3 的，
  // 如果这里也丢到后台异步，等于图永远赶不上这一趟推送。
  let pluginScreenshot: { saved: boolean; uploaded: boolean; message: string } | null = null;
  if (pluginScreenshotBase64 && savedRecords.length > 0) {
    const target = savedRecords[0];
    pluginScreenshot = await savePluginScreenshotForRecord(
      target.id,
      String(target.record.url ?? ''),
      pluginScreenshotBase64
    ).catch((error) => ({
      saved: false,
      uploaded: false,
      message: error instanceof Error ? error.message : String(error)
    }));
  } else if (pluginScreenshotBase64) {
    pluginScreenshot = { saved: false, uploaded: false, message: '本次没有新增或更新记录，截图未保存' };
  }

  // 入库即触发截图（不等结果）：插件路由与网页粘贴录入共用这里，避免两条路径各截一次。
  // 截图失败的记录按既有规则降级 v3，不阻塞录入。
  // 插件已经自己截过图的那条要排除掉，否则服务端会再截一次把插件的图覆盖掉
  // （小红书有登录墙，服务端截出来多半是登录页，覆盖等于把好图换成坏图）。
  const pluginShotRecordId = pluginScreenshot?.saved ? savedRecords[0].id : null;
  scheduleScreenshots(
    savedRecords
      .filter(({ id, record }) => Boolean(record.url) && id !== pluginShotRecordId)
      .map(({ id, record }) => ({ id, url: record.url }))
  );

  return NextResponse.json({
    total: rawRecords.length,
    saved: savedRecords.length,
    duplicate: duplicateRecords.length,
    updated: updatedRecords.length,
    blocked: blockedRecords.length,
    blockedRecords,
    eventSync,
    savedRecordIds: savedRecords.map((item) => item.id),
    // 插件自带截图的处理结果；没带截图时为 null，插件据此判断要不要提示
    screenshot: pluginScreenshot,
    preview: previewRecords,
    missingFields: missingForResponse,
    rawBlocks,
    canPush: !hasMissing && savedRecords.length > 0,
    warning: blockedRecords.length > 0
      ? `已保存 ${savedRecords.length} 条，${blockedRecords.length} 条记录正在推送，禁止覆盖在途内容，请稍后重试`
      : hasMissing
        ? '检测到必填项缺失，请先补齐后再推送'
        : duplicateRecords.length > 0
          ? `解析完成：新增或更新 ${savedRecords.length} 条，跳过未变化记录 ${duplicateRecords.length} 条`
          : '解析完成，已保存为待推送记录'
  });
}
