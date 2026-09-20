import { NextResponse } from 'next/server';
import { isPublishTimeInFuture, mapRawRecordToPushRecord, normalizePublishTimeToDate } from '@/lib/mapping';
import { extractRawBlocks, findMissingFields, parseRawTextRecords } from '@/lib/raw-parser';
import { pushRecordsSaveSchema, pushRecordSchema } from '@/lib/schemas';
import type { PushRecordInput } from '@/lib/schemas';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { MediaRuleType } from '@prisma/client';
import { classifyAuthorType, classifyPublisherType, getDomainFromUrl } from '@/lib/media-classification';
import { syncDailyCollectionEvents } from '@/lib/daily-event-sync';
import { generateBatchNo } from '@/lib/business-no';

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
  const auth = await requireApiUser(request);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const sourceText = String(body?.sourceText ?? '');
  const selectedTendency = String(body?.tendency ?? '').trim();

  if (!sourceText.trim() && !Array.isArray(body?.records)) {
    return NextResponse.json({ code: 40002, message: '请输入 sourceText 或 records' }, { status: 400 });
  }

  const rawBlocks = sourceText.trim() ? extractRawBlocks(sourceText) : [];
  const futureRows = sourceText.trim() ? parseRawTextRecords(sourceText).map((item, index) => ({ index, future: isPublishTimeInFuture(item.time) })).filter((item) => item.future) : [];
  if (futureRows.length > 0) {
    return NextResponse.json({ code: 40005, message: '存在发布时间晚于当前时间的记录，请检查相对时间换算', futureRows }, { status: 422 });
  }
  const missing = sourceText.trim() ? findMissingFields(sourceText) : [];
  const parsedRawRecords = sourceText.trim() ? parseRawTextRecords(sourceText) : [];
  const rawRecords = Array.isArray(body?.records)
    ? body.records
    : parsedRawRecords.map((item) => mapRawRecordToPushRecord(item));

  const batchCheck = pushRecordsSaveSchema.safeParse({ version: '3', records: rawRecords });
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

  // 逐条校验：跳过非法记录（如链接为空、计数非法），避免单条异常导致整批不保存
  const validRecords: PushRecordInput[] = [];
  const validTendencies: Array<string | null> = [];
  const invalidIndexes: number[] = [];
  for (let index = 0; index < rawRecords.length; index += 1) {
    const parsed = pushRecordSchema.safeParse(rawRecords[index]);
    if (parsed.success) {
      validRecords.push(parsed.data);
      validTendencies.push(
        parsedRawRecords[index]?.tendency || selectedTendency ||
          (Array.isArray(body?.records) &&
          typeof rawRecords[index] === 'object' &&
          rawRecords[index] !== null &&
          'tendency' in (rawRecords[index] as object)
            ? String((rawRecords[index] as { tendency?: unknown }).tendency ?? '') || null
            : null)
      );
    } else {
      invalidIndexes.push(index);
    }
  }

  if (validRecords.length === 0) {
    return NextResponse.json(
      {
        code: 40002,
        message: `没有可保存的有效记录${invalidIndexes.length ? `（${invalidIndexes.length} 条记录字段不合法，请检查后重试）` : ''}`,
        missingFields: missing,
        rawBlocks
      },
      { status: 400 }
    );
  }

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

  const savedRecords = [] as Array<{ id: string; textId: string }>;
  const duplicateRecords: Array<{ index: number; textId: string }> = [];
  const updatedRecords: Array<{ index: number; textId: string }> = [];
  for (let index = 0; index < uniqueRecords.length; index += 1) {
    const record = uniqueRecords[index];
    const tendency = (uniqueTendencies[index] ?? selectedTendency) || null;
    const publishTime = normalizePublishTimeToDate(record.publishTime);
    const rawSourceText = JSON.stringify(sourceText.trim() ? parsedRawRecords[uniqueSourceIndexes[index]] ?? record : record);
    const sourceRow = rawRecords[uniqueSourceIndexes[index]] as Record<string, unknown> | undefined;
    const parsedSource = (parsedRawRecords[uniqueSourceIndexes[index]] as { source?: string } | undefined)?.source;
    const bodySource = typeof sourceRow?.source === 'string' ? sourceRow.source : typeof sourceRow?.['来源'] === 'string' ? String(sourceRow['来源']) : '';
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
      const changed = existing.title !== record.title || existing.text !== record.text ||
        existing.publishTime.getTime() !== publishTime.getTime() || existing.author !== record.author ||
        existing.originType !== record.originType || existing.publisherType !== record.publisherType ||
        existing.authorType !== record.authorType || existing.url !== record.url ||
        existing.commentNum !== record.commentNum || existing.forwardNum !== record.forwardNum ||
        existing.praiseNum !== record.praiseNum || existing.viewNum !== record.viewNum ||
        existing.tendency !== tendency;

      if (!changed) {
        duplicateRecords.push({ index, textId: record.textId });
        continue;
      }

      await prisma.dataRecord.update({
        where: { id: existing.id },
        data: {
          title: record.title,
          text: record.text,
          publishTime,
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
          recordStatus: 'PENDING_PUSH',
          rawSourceText,
          sourceName,
          sourceRowNo: uniqueSourceIndexes[index] + 1
        }
      });
      updatedRecords.push({ index, textId: record.textId });
      savedRecords.push({ id: existing.id, textId: existing.textId });
      continue;
    }

    const saved = await prisma.dataRecord.create({
      data: {
        batchId: batch.id,
        textId: record.textId,
        title: record.title,
        text: record.text,
        publishTime,
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
        recordStatus: 'PENDING_PUSH',
        createdById: currentUser.id,
        rawSourceText,
        sourceName,
        sourceRowNo: uniqueSourceIndexes[index] + 1
      }
    });
    savedRecords.push({ id: saved.id, textId: saved.textId });
  }

  await prisma.dataBatch.update({
    where: { id: batch.id },
    data: {
      validCount: savedRecords.length,
      invalidCount: uniqueRecords.length - savedRecords.length,
      remark: `${sourceText.trim() ? '粘贴解析保存' : '接口保存'}，新增 ${savedRecords.length - updatedRecords.length} 条，更新 ${updatedRecords.length} 条，跳过未变化 ${duplicateRecords.length} 条`
    }
  });

  const eventSync = await syncDailyCollectionEvents(uniqueRecords
    .map((record, index) => ({
      record,
      tendency: (uniqueTendencies[index] ?? selectedTendency) || null,
      rowNo: uniqueSourceIndexes[index] + 1
    }))
    .filter((item) => savedRecords.some((saved) => saved.textId === item.record.textId)));

  return NextResponse.json({
    total: rawRecords.length,
    saved: savedRecords.length,
    duplicate: duplicateRecords.length,
    updated: updatedRecords.length,
    eventSync,
    savedRecordIds: savedRecords.map((item) => item.id),
    preview: previewRecords,
    missingFields: missingForResponse,
    rawBlocks,
    canPush: !hasMissing && savedRecords.length > 0,
    warning: hasMissing
      ? '检测到必填项缺失，请先补齐后再推送'
      : duplicateRecords.length > 0
        ? `解析完成：新增或更新 ${savedRecords.length} 条，跳过未变化记录 ${duplicateRecords.length} 条`
        : '解析完成，已保存为待推送记录'
  });
}
