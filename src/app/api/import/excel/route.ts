import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPublishTimeInFuture, mapRawRecordToPushRecord, normalizePublishTimeToDate } from '@/lib/mapping';
import { pushRequestSchema } from '@/lib/schemas';
import type { PushRecordInput } from '@/lib/schemas';
import { requireApiUser } from '@/lib/api-auth';
import { pushExistingRecords } from '@/lib/push-workflow';
import { syncDailyCollectionEvents } from '@/lib/daily-event-sync';

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

function toLocalDateTime(value: string) {
  const normalized = value.trim().replace(/[./]/g, '-').replace('年', '-').replace('月', '-').replace('日', '');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return normalizePublishTimeToDate(value);
  // Excel 导入的时间按表格显示的北京时间保存，不把无时区字符串当 UTC 再加 8 小时。
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
}

function valuesChanged(existing: {
  title: string; text: string; publishTime: Date; author: string; originType: string; publisherType: string;
  authorType: string | null; url: string; commentNum: number; forwardNum: number | null; praiseNum: number | null;
  viewNum: number | null; tendency: string | null;
}, record: PushRecordInput, tendency: string | null, publishTime: Date) {
  return existing.title !== record.title || existing.text !== record.text ||
    existing.publishTime.getTime() !== publishTime.getTime() || existing.author !== record.author ||
    existing.originType !== record.originType || existing.publisherType !== record.publisherType ||
    existing.authorType !== record.authorType || existing.url !== record.url ||
    existing.commentNum !== record.commentNum || existing.forwardNum !== record.forwardNum ||
    existing.praiseNum !== record.praiseNum || existing.viewNum !== record.viewNum ||
    existing.tendency !== tendency;
}

export async function POST(request: Request) {
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
          // ExcelJS 会把日期单元格转换成 Date；在服务器时区与 Excel 显示时区不同的情况下，
          // 直接取 Date 的小时可能发生偏移。优先使用单元格显示文本，保持用户在 Excel 中看到的时间。
          raw[header] = getCellString(cell.value);
        });
        importedRows.push({ rowNo, raw });
      }
    }

    if (importedRows.length === 0) return NextResponse.json({ code: 40002, message: 'Excel 中没有数据行' }, { status: 400 });

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

    const getField = (raw: Record<string, string>, keys: string[]) => {
      for (const key of keys) {
        const value = raw[key];
        if (value !== undefined && value !== '') return value;
      }
      return '';
    };

    const affectedRecords: Array<{ id: string; textId: string; rowNo: number; payload: PushRecordInput; tendency: string | null }> = [];
    const invalidRows: Array<{ rowNo: number; missing: string[] }> = [];
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const item of importedRows) {
      const tendency = getField(item.raw, ['倾向性']) || null;
      const summary = getField(item.raw, ['简述', '摘要']);
      const normalized = mapRawRecordToPushRecord({
        tendency: tendency ?? undefined,
        source: getField(item.raw, ['来源']),
        author: getField(item.raw, ['作者']),
        time: getField(item.raw, ['时间']),
        title: getField(item.raw, ['标题']),
        link: getField(item.raw, ['链接']),
        summary,
        commentNum: getField(item.raw, ['评论数']) && !['-', '—'].includes(getField(item.raw, ['评论数'])) ? Number(getField(item.raw, ['评论数'])) : 0,
        forwardNum: toNullableNumber(getField(item.raw, ['转发数', '转发量'])),
        praiseNum: toNullableNumber(getField(item.raw, ['点赞数', '点赞量'])),
        viewNum: toNullableNumber(getField(item.raw, ['阅读数', '阅读量', '浏览量']))
      });

      const validated = pushRequestSchema.shape.records.element.safeParse(normalized);
      if (!validated.success) {
        const required = ['来源', '作者', '时间', '标题', '链接', '简述/摘要', '评论数'];
        const missing = required.filter((field) => field === '简述/摘要' ? !summary : !getField(item.raw, [field]));
        invalidRows.push({ rowNo: item.rowNo, missing: missing.length ? missing : ['字段格式不合法'] });
        continue;
      }

      const publishTime = toLocalDateTime(getField(item.raw, ['时间']));
      if (isPublishTimeInFuture(getField(item.raw, ['时间']), new Date())) {
        invalidRows.push({ rowNo: item.rowNo, missing: ['发布时间晚于当前时间'] });
        continue;
      }
      const existing = await prisma.dataRecord.findFirst({
      where: {
        OR: [
          { textId: normalized.textId },
          { url: normalized.url }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });
      if (existing) {
        if (!valuesChanged(existing, normalized, tendency, publishTime)) {
          skippedCount += 1;
          continue;
        }
        await prisma.dataRecord.update({
          where: { id: existing.id },
          data: {
            title: normalized.title,
            text: normalized.text,
            publishTime,
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
            sourceName: getField(item.raw, ['来源']) || null,
            recordStatus: 'PENDING_PUSH'
          }
        });
        affectedRecords.push({ id: existing.id, textId: existing.textId, rowNo: item.rowNo, payload: validated.data, tendency });
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
          sourceName: getField(item.raw, ['来源']) || null,
          recordStatus: 'PENDING_PUSH',
          createdById: currentUser.id
        }
      });
      affectedRecords.push({ id: created.id, textId: created.textId, rowNo: item.rowNo, payload: validated.data, tendency });
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
