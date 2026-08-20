import { NextResponse } from 'next/server';
import { mapRawRecordToPushRecord } from '@/lib/mapping';
import { extractRawBlocks, findMissingFields, parseRawTextRecords } from '@/lib/raw-parser';
import { pushRequestSchema } from '@/lib/schemas';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const sourceText = String(body?.sourceText ?? '');

  if (!sourceText.trim() && !Array.isArray(body?.records)) {
    return NextResponse.json({ code: 40002, message: '请输入 sourceText 或 records' }, { status: 400 });
  }

  const rawBlocks = sourceText.trim() ? extractRawBlocks(sourceText) : [];
  const missing = sourceText.trim() ? findMissingFields(sourceText) : [];
  const parsedRawRecords = sourceText.trim() ? parseRawTextRecords(sourceText) : [];
  const records = Array.isArray(body?.records)
    ? body.records
    : parsedRawRecords.map((item) => mapRawRecordToPushRecord(item));

  const result = pushRequestSchema.safeParse({ version: '1', records });
  if (!result.success) {
    return NextResponse.json(
      {
        code: 40002,
        message: result.error.issues[0]?.message ?? '请求体校验失败',
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

  const hasMissing = missing.some((item) => item.missing.length > 0);
  const uniqueRecords = result.data.records.filter((record, index, list) => index === list.findIndex((item) => item.textId === record.textId));
  const previewRecords = uniqueRecords.map((record, index) => ({
    ...record,
    tendency: parsedRawRecords[index]?.tendency ?? (Array.isArray(body?.records) ? (body.records[index] as { tendency?: string } | undefined)?.tendency ?? null : null)
  }));

  const batch = await prisma.dataBatch.create({
    data: {
      batchNo: `BATCH-${Date.now()}`,
      importType: 'PASTE',
      totalCount: uniqueRecords.length,
      validCount: uniqueRecords.length,
      invalidCount: 0,
      createdById: currentUser.id,
      status: 'PENDING_PUSH',
      remark: sourceText.trim() ? '粘贴解析保存' : '接口保存'
    }
  });

  const savedRecords = [] as Array<{ id: string; textId: string }>;
  for (let index = 0; index < uniqueRecords.length; index += 1) {
    const record = uniqueRecords[index];
    const saved = await prisma.dataRecord.create({
      data: {
        batchId: batch.id,
        textId: record.textId,
        title: record.title,
        text: record.text,
        publishTime: new Date(record.publishTime.replace(' ', 'T')),
        author: record.author,
        originType: record.originType,
        publisherType: record.publisherType,
        authorType: record.authorType,
        url: record.url,
        commentNum: record.commentNum,
        forwardNum: record.forwardNum,
        praiseNum: record.praiseNum,
        viewNum: record.viewNum,
        tendency: previewRecords[index]?.tendency ?? null,
        recordStatus: 'PENDING_PUSH',
        createdById: currentUser.id,
        rawSourceText: JSON.stringify(sourceText.trim() ? parsedRawRecords[index] ?? record : record),
        sourceRowNo: index + 1
      }
    });
    savedRecords.push({ id: saved.id, textId: saved.textId });
  }

  return NextResponse.json({
    total: result.data.records.length,
    saved: savedRecords.length,
    savedRecordIds: savedRecords.map((item) => item.id),
    preview: result.data.records,
    missingFields: missing,
    rawBlocks,
    canPush: !hasMissing && result.data.records.length > 0,
    warning: hasMissing
      ? '检测到必填项缺失，请先补齐后再推送'
      : '解析完成，已保存为待推送记录'
  });
}
