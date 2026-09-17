import { prisma } from '@/lib/prisma';
import { getConfig, CONFIG_KEYS } from '@/lib/push-config';
import { getTencentDocSheetData, getTencentDocSheets } from '@/lib/tencent-doc-api';
import { isPublishTimeInFuture, mapRawRecordToPushRecord, normalizePublishTimeToDate } from '@/lib/mapping';
import { pushRequestSchema } from '@/lib/schemas';
import type { PushRecordInput } from '@/lib/schemas';
import { pushExistingRecords } from '@/lib/push-workflow';
import { syncDailyCollectionEvents } from '@/lib/daily-event-sync';

export type DocumentSyncTrigger = 'MANUAL' | 'SCHEDULED';

type Cell = { cellValue?: { text?: string; number?: number; time?: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }; link?: { url?: string; text?: string } } | null };

type Affected = { id: string; payload: PushRecordInput; tendency: string; rowNo: number; sheetId: string };
type SyncRow = { rowNo: number; sheetId: string; raw: Record<string, string> };

function cellText(cell: Cell | undefined) {
  const value = cell?.cellValue;
  if (!value) return '';
  if (value.text !== undefined) return value.text.trim();
  if (value.number !== undefined) return String(value.number);
  if (value.link) return String(value.link.url ?? value.link.text ?? '').trim();
  if (value.time) {
    const pad = (item: number | undefined) => String(item ?? 0).padStart(2, '0');
    return `${value.time.year}-${pad(value.time.month)}-${pad(value.time.day)} ${pad(value.time.hour)}:${pad(value.time.minute)}:${pad(value.time.second)}`;
  }
  return '';
}

function field(raw: Record<string, string>, aliases: string[]) {
  return aliases.map((alias) => raw[alias]).find((value) => value !== undefined && value !== '') ?? '';
}

function toNumber(value: string) {
  if (!value) return null;
  const number = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function buildRawRows(body: unknown, sheetId: string): SyncRow[] {
  const response = body as { gridData?: { rows?: Array<{ values?: Cell[] }> }; data?: { gridData?: { rows?: Array<{ values?: Cell[] }> } } };
  const rows = response.gridData?.rows ?? response.data?.gridData?.rows ?? [];
  const headers = (rows[0]?.values ?? []).map((cell) => cellText(cell));
  return rows.slice(1).map((row, index) => {
    const raw: Record<string, string> = {};
    (row.values ?? []).forEach((cell, column) => {
      const header = headers[column];
      if (header) raw[header] = cellText(cell);
    });
    return { rowNo: index + 2, sheetId, raw };
  }).filter((item) => Object.values(item.raw).some(Boolean));
}

function changed(existing: { title: string; text: string; publishTime: Date; author: string; url: string; commentNum: number; forwardNum: number | null; praiseNum: number | null; viewNum: number | null; tendency: string | null }, record: PushRecordInput, tendency: string) {
  const publishTime = normalizePublishTimeToDate(record.publishTime);
  return existing.title !== record.title || existing.text !== record.text || existing.publishTime.getTime() !== publishTime.getTime() || existing.author !== record.author || existing.url !== record.url || existing.commentNum !== record.commentNum || existing.forwardNum !== record.forwardNum || existing.praiseNum !== record.praiseNum || existing.viewNum !== record.viewNum || existing.tendency !== tendency;
}

export async function runTencentDocumentSync(triggerType: DocumentSyncTrigger) {
  const fileId = process.env.TENCENT_DOC_FILE_ID || '';
  const [sheetIdsConfig, rangeConfig] = await Promise.all([
    getConfig(CONFIG_KEYS.TENCENT_DOC_SHEET_IDS),
    getConfig(CONFIG_KEYS.TENCENT_DOC_RANGE)
  ]);
  const sheetIds = (sheetIdsConfig || 'BB08J2,l266vy,00d86f').split(',').map((item) => item.trim()).filter(Boolean);
  const range = rangeConfig || 'A1:Z200';
  if (!fileId) throw new Error('未配置 TENCENT_DOC_FILE_ID');

  const sourceUrl = `https://docs.qq.com/sheet/${fileId}?tabs=${sheetIds.join(',')}`;
  if (await prisma.documentSyncLog.findFirst({ where: { status: 'RUNNING' }, select: { id: true } })) throw new Error('已有腾讯文档同步任务正在执行');
  const log = await prisma.documentSyncLog.create({ data: { triggerType, sourceUrl, status: 'RUNNING' } });

  try {
    const sheetInfo = await getTencentDocSheets();
    const availableIds = new Set((sheetInfo?.properties ?? []).map((item: { sheetId: string }) => item.sheetId));
    const missingSheet = sheetIds.find((sheetId) => !availableIds.has(sheetId));
    if (missingSheet) throw new Error(`工作表不存在：${missingSheet}`);
    const rows: SyncRow[] = [];
    for (const sheetId of sheetIds) {
      const body = await getTencentDocSheetData(sheetId, range);
      rows.push(...buildRawRows(body, sheetId));
    }
    const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    if (!user) throw new Error('未找到启用用户');

    const batch = await prisma.dataBatch.create({ data: { batchNo: `TENCENT-${Date.now()}`, importType: 'EXCEL', totalCount: rows.length, validCount: 0, invalidCount: 0, createdById: user.id, status: 'VALIDATING', remark: '腾讯文档在线表格同步' } });
    const affected: Affected[] = [];
    const invalidRows: Array<{ rowNo: number; reason: string }> = [];
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const item of rows) {
      const tendency = field(item.raw, ['倾向性']);
      const summary = field(item.raw, ['简述', '摘要']);
      const link = field(item.raw, ['链接']);
      if (!tendency) { invalidRows.push({ rowNo: item.rowNo, reason: '缺少倾向性' }); continue; }
      if (!link || !field(item.raw, ['标题']) || !field(item.raw, ['时间'])) { invalidRows.push({ rowNo: item.rowNo, reason: '缺少标题、时间或链接' }); continue; }

      const record = mapRawRecordToPushRecord({
        tendency, source: field(item.raw, ['来源']), author: field(item.raw, ['作者']), time: field(item.raw, ['时间']), title: field(item.raw, ['标题']), link, summary,
        commentNum: toNumber(field(item.raw, ['评论数'])) ?? 0,
        forwardNum: toNumber(field(item.raw, ['转发数', '转发量'])),
        praiseNum: toNumber(field(item.raw, ['点赞数', '点赞量'])),
        viewNum: toNumber(field(item.raw, ['阅读数', '阅读量', '浏览量']))
      });
      if (!pushRequestSchema.shape.records.element.safeParse(record).success) { invalidRows.push({ rowNo: item.rowNo, reason: '字段格式不合法' }); continue; }
      if (isPublishTimeInFuture(record.publishTime)) { invalidRows.push({ rowNo: item.rowNo, reason: '发布时间晚于当前时间' }); continue; }

      const existing = await prisma.dataRecord.findFirst({ where: { OR: [{ textId: record.textId }, { url: record.url }] }, orderBy: { createdAt: 'asc' } });
      if (existing && !changed(existing, record, tendency)) { skippedCount += 1; continue; }
      const data = { title: record.title, text: record.text, publishTime: normalizePublishTimeToDate(record.publishTime), author: record.author, originType: record.originType, publisherType: record.publisherType, authorType: record.authorType, url: record.url, commentNum: record.commentNum, forwardNum: record.forwardNum, praiseNum: record.praiseNum, viewNum: record.viewNum, tendency, rawSourceText: JSON.stringify({ sheetId: item.sheetId, ...item.raw }), sourceRowNo: item.rowNo, recordStatus: 'PENDING_PUSH' as const };
      const saved = existing ? await prisma.dataRecord.update({ where: { id: existing.id }, data }) : await prisma.dataRecord.create({ data: { ...data, batchId: batch.id, textId: record.textId, createdById: user.id } });
      affected.push({ id: saved.id, payload: record, tendency, rowNo: item.rowNo, sheetId: item.sheetId });
      if (existing) updatedCount += 1; else createdCount += 1;
    }

    const eventSync = await syncDailyCollectionEvents(affected.map((item) => ({ record: item.payload, tendency: item.tendency, rowNo: item.rowNo })));
    let pushedCount = 0;
    let failedCount = 0;
    let pushError = '';
    if (affected.length) {
      try {
        const result = await pushExistingRecords(user.id, affected.map((item) => item.id));
        pushedCount = result.results.reduce((sum, item) => sum + item.inserted, 0);
        failedCount = result.results.reduce((sum, item) => sum + item.failed, 0);
      } catch (error) { pushError = error instanceof Error ? error.message : '推送失败'; failedCount = affected.length; }
    }

    const status = pushError || failedCount ? 'PARTIAL_SUCCESS' : 'SUCCESS';
    const result = { totalRows: rows.length, createdCount, updatedCount, skippedCount, invalidCount: invalidRows.length, pushedCount, failedCount, eventSync, invalidRows, pushError };
    await prisma.dataBatch.update({ where: { id: batch.id }, data: { validCount: affected.length, invalidCount: invalidRows.length + skippedCount, status: failedCount ? 'PARTIAL_SUCCESS' : 'SUCCESS', pushedAt: new Date(), pushCount: affected.length ? 1 : 0, successCount: failedCount ? 0 : affected.length, failCount: failedCount ? 1 : 0, remark: `腾讯文档：新增 ${createdCount} 条，更新 ${updatedCount} 条，跳过 ${skippedCount} 条，无效 ${invalidRows.length} 条` } });
    await prisma.documentSyncLog.update({ where: { id: log.id }, data: { ...result, status, details: { invalidRows, eventSync }, errorMessage: pushError || null, finishedAt: new Date() } });
    return { id: log.id, status, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.documentSyncLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: message, finishedAt: new Date() } });
    throw error;
  }
}
