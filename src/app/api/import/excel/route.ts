import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPublishTimeInFuture, mapRawRecordToPushRecord, normalizePublishTimeToDate } from '@/lib/mapping';
import { pushRequestSchema } from '@/lib/schemas';
import type { PushRecordInput } from '@/lib/schemas';
import { requireApiUser } from '@/lib/api-auth';
import { pushExistingRecords } from '@/lib/push-workflow';
import { syncDailyCollectionEvents } from '@/lib/daily-event-sync';
import { normalizeRawCrawlTime } from '@/lib/raw-parser';

function getCellString(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Excel 的日期序列本身没有时区。ExcelJS 读取后会以 UTC Date 承载该序列；
    // 取本地 getHours() 会在东八区额外加 8 小时，必须取 UTC 分量还原表格显示时间。
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const h = String(value.getUTCHours()).padStart(2, '0');
    const min = String(value.getUTCMinutes()).padStart(2, '0');
    const s = String(value.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  if (typeof value === 'object' && 'result' in value && value.result instanceof Date) return getCellString(value.result);
  return String(value).trim();
}

function toNullableNumber(value: string) {
  if (!value || ['-', '—'].includes(value.trim())) return null;
  const number = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function valuesChanged(existing: {
  title: string; text: string; publishTime: Date; author: string; originType: string; publisherType: string;
  authorType: string | null; url: string; commentNum: number; forwardNum: number | null; praiseNum: number | null;
  viewNum: number | null; tendency: string | null; sourceName: string | null;
}, record: PushRecordInput, tendency: string | null, publishTime: Date, sourceName: string | null) {
  return existing.title !== record.title || existing.text !== record.text ||
    existing.publishTime.getTime() !== publishTime.getTime() || existing.author !== record.author ||
    existing.originType !== record.originType || existing.publisherType !== record.publisherType ||
    existing.authorType !== record.authorType || existing.url !== record.url ||
    existing.commentNum !== record.commentNum || existing.forwardNum !== record.forwardNum ||
    existing.praiseNum !== record.praiseNum || existing.viewNum !== record.viewNum ||
    existing.tendency !== tendency || existing.sourceName !== sourceName;
}

export async function POST(request: Request) {
  const receivedAt = new Date();
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return NextResponse.json({ code: 40002, message: '未上传文件' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) return NextResponse.json({ code: 40002, message: '文件内容为空' }, { status: 400 });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const importedRows: Array<{ rowNo: number; raw: Record<string, string> }> = [];
    for (const worksheet of workbook.worksheets) {
      const headerRow = worksheet.getRow(1);
      const headerValues = Array.isArray(headerRow.values) ? headerRow.values : [];
      const headers: string[] = headerValues.slice(1).map((value: unknown) => getCellString(value as ExcelJS.CellValue));
      for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
        const row = worksheet.getRow(rowNo);
        if (row.actualCellCount === 0) continue;
        const raw: Record<string, string> = {};
        headers.forEach((header: string, index: number) => {
          const cell = row.getCell(index + 1);
          // 日期取 ExcelJS Date 的 UTC 分量还原显示时间，再按北京时间解析。
          raw[header] = getCellString(cell.value);
        });
        importedRows.push({ rowNo, raw });
      }
    }

    if (importedRows.length === 0) return NextResponse.json({ code: 40002, message: 'Excel 中没有数据行' }, { status: 400 });

    const getField = (raw: Record<string, string>, keys: string[]) => {
      for (const key of keys) {
        const value = raw[key];
        if (value !== undefined && value !== '') return value;
      }
      return '';
    };

    // 先完成整批字段校验，再逐行处理业务错误与保存，保持 invalidRows 格式。
    const preparedRows = importedRows.map((item) => {
      const tendency = getField(item.raw, ['倾向性']) || null;
      const summary = getField(item.raw, ['简述', '摘要']);
      const publishTimeText = getField(item.raw, ['发布时间', '时间']);
      const normalized = mapRawRecordToPushRecord({
        tendency: tendency ?? undefined,
        source: getField(item.raw, ['来源']),
        author: getField(item.raw, ['作者']),
        time: publishTimeText,
        crawlTime: normalizeRawCrawlTime(getField(item.raw, ['采集时间', '抓取时间', '爬取时间', 'crawlTime']) || undefined) ?? receivedAt.toISOString(),
        title: getField(item.raw, ['标题']),
        link: getField(item.raw, ['链接']),
        summary,
        commentNum: getField(item.raw, ['评论数']) && !['-', '—'].includes(getField(item.raw, ['评论数'])) ? Number(getField(item.raw, ['评论数'])) : 0,
        forwardNum: toNullableNumber(getField(item.raw, ['转发数', '转发量'])),
        praiseNum: toNullableNumber(getField(item.raw, ['点赞数', '点赞量'])),
        viewNum: toNullableNumber(getField(item.raw, ['阅读数', '阅读量', '浏览量']))
      });

      return { item, tendency, summary, publishTimeText, validated: pushRequestSchema.shape.records.element.safeParse(normalized) };
    });

    const currentUser = await prisma.user.findUnique({ where: { id: auth.user.id } });
    if (!currentUser) return NextResponse.json({ code: 50000, message: '未找到当前用户' }, { status: 500 });

    const batchNo = `BATCH-${Date.now()}`;
    const batch = await prisma.dataBatch.create({
      data: {
        batchNo,
        importType: 'EXCEL',
        sourceFileName: file.name,
        totalCount: importedRows.length,
        validCount: 0,
        invalidCount: 0,
        createdById: currentUser.id,
        status: 'VALIDATING',
        remark: 'Excel 导入处理中'
      }
    });
    const affectedRecords: Array<{ id: string; textId: string; rowNo: number; payload: PushRecordInput; tendency: string | null }> = [];
    const invalidRows: Array<{ rowNo: number; missing: string[] }> = [];
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const { item, tendency, summary, publishTimeText, validated } of preparedRows) {
      if (!validated.success) {
        const required = ['来源', '作者', '发布时间', '标题', '链接', '简述/摘要', '评论数'];
        const missing = required.filter((field) => field === '简述/摘要' ? !summary
          : field === '发布时间' ? !publishTimeText : !getField(item.raw, [field]));
        invalidRows.push({ rowNo: item.rowNo, missing: isPublishTimeInFuture(publishTimeText, receivedAt)
          ? ['发布时间晚于当前时间'] : missing.length ? missing : ['字段格式不合法'] });
        continue;
      }

      const normalized = validated.data;
      const publishTime = normalizePublishTimeToDate(normalized.publishTime);
      const crawlTime = normalized.crawlTime ? new Date(normalized.crawlTime) : receivedAt;
      const sourceName = getField(item.raw, ['来源']).trim() || null;
      const existing = await prisma.dataRecord.findFirst({
        where: { OR: [{ textId: normalized.textId }, { url: normalized.url }] },
        orderBy: { createdAt: 'asc' }
      });
      if (existing) {
        if (!valuesChanged(existing, normalized, tendency, publishTime, sourceName)) {
          skippedCount += 1;
          continue;
        }
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
            title: normalized.title,
            text: normalized.text,
            publishTime,
            crawlTime,
            author: normalized.author,
            originType: normalized.originType,
            publisherType: normalized.publisherType,
            authorType: normalized.authorType,
            url: normalized.url,
            commentNum: normalized.commentNum,
            forwardNum: normalized.forwardNum,
            praiseNum: normalized.praiseNum,
            viewNum: normalized.viewNum,
            tendency,
            rawSourceText: JSON.stringify(item.raw),
            sourceRowNo: item.rowNo,
            sourceName,
            recordStatus: 'PENDING_PUSH'
          }
        });
        if (updated.count === 0) {
          invalidRows.push({ rowNo: item.rowNo, missing: ['记录正在推送，禁止覆盖在途内容，请稍后重试'] });
          continue;
        }
        affectedRecords.push({ id: existing.id, textId: existing.textId, rowNo: item.rowNo, payload: { ...normalized, textId: existing.textId }, tendency });
        updatedCount += 1;
        continue;
      }

      const created = await prisma.dataRecord.create({
        data: {
          batchId: batch.id,
          textId: normalized.textId,
          title: normalized.title,
          text: normalized.text,
          publishTime,
          crawlTime,
          author: normalized.author,
          originType: normalized.originType,
          publisherType: normalized.publisherType,
          authorType: normalized.authorType,
          url: normalized.url,
          commentNum: normalized.commentNum,
          forwardNum: normalized.forwardNum,
          praiseNum: normalized.praiseNum,
          viewNum: normalized.viewNum,
          tendency,
          rawSourceText: JSON.stringify(item.raw),
          sourceRowNo: item.rowNo,
          sourceName,
          recordStatus: 'PENDING_PUSH',
          createdById: currentUser.id
        }
      });
      affectedRecords.push({ id: created.id, textId: created.textId, rowNo: item.rowNo, payload: { ...normalized, textId: created.textId }, tendency });
      createdCount += 1;
    }

    let pushResult: Awaited<ReturnType<typeof pushExistingRecords>> | null = null;
    let pushError = '';
    const eventSync = await syncDailyCollectionEvents(affectedRecords.map((item) => ({
      record: item.payload,
      tendency: item.tendency,
      rowNo: item.rowNo
    })));

    if (affectedRecords.length > 0) {
      try {
        pushResult = await pushExistingRecords(currentUser.id, affectedRecords.map((item) => item.id));
      } catch (error) {
        pushError = error instanceof Error ? error.message : '推送失败';
      }
    }

    const hasPushFailure = Boolean(pushError) || Boolean(pushResult?.results.some((item) => item.failed > 0));
    const finalStatus = affectedRecords.length === 0 ? 'SUCCESS' : hasPushFailure ? 'PARTIAL_SUCCESS' : 'SUCCESS';

    await prisma.dataBatch.update({
      where: { id: batch.id },
      data: {
        validCount: affectedRecords.length,
        invalidCount: importedRows.length - affectedRecords.length,
        status: finalStatus,
        pushedAt: affectedRecords.length > 0 ? new Date() : null,
        pushCount: pushResult?.results.length ?? 0,
        successCount: hasPushFailure ? 0 : affectedRecords.length,
        failCount: hasPushFailure ? affectedRecords.length : 0,
        remark: `Excel 导入：新增 ${createdCount} 条，更新 ${updatedCount} 条，跳过未变化 ${skippedCount} 条${pushError ? `；推送异常：${pushError}` : ''}`
      }
    });

    return NextResponse.json({
      batchNo,
      imported: importedRows.length,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      saved: affectedRecords.length,
      invalid: invalidRows.length,
      invalidRows,
      eventSync,
      affectedRecordIds: affectedRecords.map((item) => item.id),
      pushResult,
      warning: pushError
        ? `Excel 已保存 ${affectedRecords.length} 条待推送记录，但推送失败：${pushError}`
        : `Excel 导入完成：新增 ${createdCount} 条，更新 ${updatedCount} 条，跳过未变化 ${skippedCount} 条`
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return NextResponse.json({ code: 50000, message: `导入失败：${errorMessage}` }, { status: 500 });
  }
}
