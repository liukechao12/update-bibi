import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mapRawRecordToPushRecord, normalizePublishTimeToDate } from '@/lib/mapping';
import { pushRequestSchema } from '@/lib/schemas';
import type { PushRecordInput } from '@/lib/schemas';
import { requireApiUser } from '@/lib/api-auth';
import { getPushConfig } from '@/lib/push-config';

type PushError = { index: number; error: string; code?: string | number | null };

function getCellString(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    const h = String(value.getHours()).padStart(2, '0');
    const min = String(value.getMinutes()).padStart(2, '0');
    const s = String(value.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  if (typeof value === 'object' && 'result' in value && value.result instanceof Date) {
    const dt = value.result;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    const s = String(dt.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }
  return String(value).trim();
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ code: 40002, message: '未上传文件' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.length === 0) {
      return NextResponse.json({ code: 40002, message: '文件内容为空' }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    // ── Phase 1: 读取 Excel 并保存到数据库 ──
    const importedRows: Array<{ rowNo: number; raw: Record<string, string> }> = [];

    for (const worksheet of workbook.worksheets) {
      const headerRow = worksheet.getRow(1);
      const headerValues = Array.isArray(headerRow.values) ? headerRow.values : [];
      const headers = headerValues.slice(1).map((value) => getCellString(value as ExcelJS.CellValue));

      for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
        const row = worksheet.getRow(rowNo);
        if (row.actualCellCount === 0) continue;

        const raw: Record<string, string> = {};
        headers.forEach((header, index) => {
          raw[header] = getCellString(row.getCell(index + 1).value);
        });
        importedRows.push({ rowNo, raw });
      }
    }

    if (importedRows.length === 0) {
      return NextResponse.json({ code: 40002, message: 'Excel 中没有数据行' }, { status: 400 });
    }

    const currentUser = await prisma.user.findUnique({ where: { id: auth.user.id } });
    if (!currentUser) {
      return NextResponse.json({ code: 50000, message: '未找到当前用户' }, { status: 500 });
    }

    const batchNo = `BATCH-${Date.now()}`;
    const batch = await prisma.dataBatch.create({
      data: {
        batchNo,
        importType: 'EXCEL',
        sourceFileName: file.name,
        totalCount: importedRows.length,
        validCount: importedRows.length,
        invalidCount: 0,
        createdById: currentUser.id,
        status: 'VALIDATING'
      }
    });

    const savedRecords: Array<{ id: string; textId: string; rowNo: number; payload: PushRecordInput }> = [];
    const missingRows: Array<{ rowNo: number; missing: string[] }> = [];

    const getField = (raw: Record<string, string>, keys: string[]) => {
      for (const key of keys) {
        const value = raw[key];
        if (value !== undefined && value !== '') return value;
      }
      return '';
    };

    for (const item of importedRows) {
      const tendency = getField(item.raw, ['倾向性']);
      const normalized = mapRawRecordToPushRecord({
        tendency,
        source: getField(item.raw, ['来源']),
        author: getField(item.raw, ['作者']),
        time: getField(item.raw, ['时间']),
        title: getField(item.raw, ['标题']),
        link: getField(item.raw, ['链接']),
        summary: getField(item.raw, ['摘要']),
        commentNum: Number(getField(item.raw, ['评论数']) || 0),
        forwardNum: getField(item.raw, ['转发数', '转发量']) ? Number(getField(item.raw, ['转发数', '转发量'])) : null,
        praiseNum: getField(item.raw, ['点赞数', '点赞量']) ? Number(getField(item.raw, ['点赞数', '点赞量'])) : null,
        viewNum: getField(item.raw, ['阅读数', '阅读量', '浏览量']) ? Number(getField(item.raw, ['阅读数', '阅读量', '浏览量'])) : null
      });

      const validated = pushRequestSchema.shape.records.element.safeParse(normalized);
      if (!validated.success) {
        const requiredFields = ['来源', '作者', '时间', '标题', '链接', '摘要', '评论数'];
        const missing = requiredFields.filter((field) => !item.raw[field]);
        missingRows.push({ rowNo: item.rowNo, missing });
        continue;
      }

      let record;
      try {
        record = await prisma.dataRecord.create({
          data: {
            batchId: batch.id,
            textId: normalized.textId,
            title: normalized.title,
            text: normalized.text,
            publishTime: normalizePublishTimeToDate(item.raw['时间']),
            author: normalized.author,
            originType: normalized.originType,
            publisherType: normalized.publisherType,
            authorType: normalized.authorType,
            url: normalized.url,
            commentNum: normalized.commentNum,
            forwardNum: normalized.forwardNum,
            praiseNum: normalized.praiseNum,
            viewNum: normalized.viewNum,
            tendency: tendency || null,
            rawSourceText: JSON.stringify(item.raw),
            sourceRowNo: item.rowNo,
            recordStatus: 'PENDING_PUSH',
            createdById: currentUser.id
          }
        });
      } catch (createError) {
        // textId 重复时，跳过这行，继续处理后面的
        if (createError instanceof Error && createError.message.includes('Unique constraint')) {
          missingRows.push({ rowNo: item.rowNo, missing: ['textId 重复，已跳过'] });
          continue;
        }
        throw createError;
      }

      savedRecords.push({ id: record.id, textId: normalized.textId, rowNo: item.rowNo, payload: validated.data });
    }

    await prisma.dataBatch.update({
      where: { id: batch.id },
      data: {
        validCount: savedRecords.length,
        invalidCount: importedRows.length - savedRecords.length,
        status: 'PUSHING'
      }
    });

    // ── Phase 2: 逐条推送 ──
    const { pushBatch } = await import('@/lib/push');
    const config = await getPushConfig();

    const results: Array<{ rowNo: number; textId: string; success: boolean; error?: string }> = [];
    let pushedCount = 0;
    let pushFailedCount = 0;

    for (const item of savedRecords) {
      await prisma.dataRecord.update({
        where: { id: item.id },
        data: { recordStatus: 'PUSHING' }
      });

      const pushJob = await prisma.pushJob.create({
        data: {
          batchId: batch.id,
          jobNo: `JOB-${Date.now()}-${item.rowNo}`,
          env: 'UAT',
          endpoint: config.url,
          requestBody: { version: '1', records: [item.payload] },
          status: 'SENDING',
          createdById: currentUser.id
        }
      });

      const pushJobItem = await prisma.pushJobItem.create({
        data: {
          pushJobId: pushJob.id,
          recordId: item.id,
          itemIndex: 1,
          status: 'SENDING'
        }
      });

      try {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs);

        let payload;
        try {
          payload = await pushBatch([item.payload], config.token, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutHandle);
        }

        const errors = (Array.isArray(payload?.errors) ? payload.errors : []) as PushError[];
        const failure = errors.find((entry) => entry.index === 0);

        await prisma.pushJob.update({
          where: { id: pushJob.id },
          data: {
            responseBody: payload,
            httpStatus: 200,
            insertedCount: payload.inserted,
            failedCount: payload.failed,
            status: payload.failed > 0 ? 'FAILED' : 'SUCCESS'
          }
        });

        await prisma.pushJobItem.update({
          where: { id: pushJobItem.id },
          data: {
            status: failure ? 'FAILED' : 'SUCCESS',
            errorMessage: failure?.error ?? null,
            vendorResponseCode: failure?.code != null ? String(failure.code) : null
          }
        });

        await prisma.dataRecord.update({
          where: { id: item.id },
          data: { recordStatus: failure ? 'FAILED' : 'SUCCESS' }
        });

        if (failure) {
          pushFailedCount += 1;
          results.push({ rowNo: item.rowNo, textId: item.textId, success: false, error: failure.error });
        } else {
          pushedCount += 1;
          results.push({ rowNo: item.rowNo, textId: item.textId, success: true });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '推送失败';

        await prisma.pushJob.update({
          where: { id: pushJob.id },
          data: {
            responseBody: { error: errorMessage },
            httpStatus: errorMessage.includes('超时') ? 504 : 500,
            failedCount: 1,
            status: 'FAILED'
          }
        });

        await prisma.pushJobItem.update({
          where: { id: pushJobItem.id },
          data: { status: 'FAILED', errorMessage }
        });

        await prisma.dataRecord.update({
          where: { id: item.id },
          data: { recordStatus: 'FAILED' }
        });

        pushFailedCount += 1;
        results.push({ rowNo: item.rowNo, textId: item.textId, success: false, error: errorMessage });
      }
    }

    // ── Phase 3: 更新批次状态 ──
    const finalStatus = pushFailedCount === 0
      ? 'SUCCESS'
      : pushedCount === 0
        ? 'FAILED'
        : 'PARTIAL_SUCCESS';

    await prisma.dataBatch.update({
      where: { id: batch.id },
      data: {
        status: finalStatus,
        pushedAt: new Date(),
        pushCount: 1,
        successCount: pushedCount,
        failCount: pushFailedCount
      }
    });

    return NextResponse.json({
      batchNo,
      imported: importedRows.length,
      saved: savedRecords.length,
      pushed: pushedCount,
      pushFailed: pushFailedCount,
      invalid: importedRows.length - savedRecords.length,
      missingRows,
      results,
      warning: `导入并推送完成：共 ${savedRecords.length} 条，成功 ${pushedCount} 条，失败 ${pushFailedCount} 条`
    });
  } catch (error) {
    console.error('Excel 导入推送失败:', error);
    const errorMessage = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    return NextResponse.json(
      { code: 50000, message: `导入失败：${errorMessage}` },
      { status: 500 }
    );
  }
}
