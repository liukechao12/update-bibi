import { prisma } from '@/lib/prisma';
import { normalizePublishTimeToDate } from '@/lib/mapping';
import type { PushRecordInput } from '@/lib/schemas';

export const DAILY_COLLECTION_CATEGORY = '日常采集';
export const DAILY_COLLECTION_SOURCE_FILE = '日常采集';

type DailyEventInput = {
  record: PushRecordInput;
  tendency?: string | null;
  rowNo: number;
};

function eventTitle(record: PushRecordInput) {
  return record.title || record.text.slice(0, 100) || '日常采集';
}

export async function syncDailyCollectionEvent(input: DailyEventInput) {
  const { record, tendency, rowNo } = input;
  const publishTime = normalizePublishTimeToDate(record.publishTime);
  const where = record.url
    ? { category: DAILY_COLLECTION_CATEGORY, link: record.url }
    : { category: DAILY_COLLECTION_CATEGORY, title: eventTitle(record), author: record.author, publishTime };

  const existing = await prisma.eventRecord.findFirst({ where });
  const data = {
    category: DAILY_COLLECTION_CATEGORY,
    sourceFileName: DAILY_COLLECTION_SOURCE_FILE,
    seqNo: rowNo,
    source: record.originType,
    author: record.author,
    fansCount: 0,
    authType: record.authorType,
    publishTime,
    title: eventTitle(record),
    link: record.url,
    summary: record.text,
    viewCount: record.viewNum ?? 0,
    forwardCount: record.forwardNum ?? 0,
    replyCount: record.commentNum,
    praiseCount: record.praiseNum ?? 0,
    tendency: tendency || null,
    rawData: record,
    rowNo
  };

  if (existing) {
    const updated = await prisma.eventRecord.update({ where: { id: existing.id }, data });
    return { action: 'updated' as const, eventRecord: updated };
  }

  const created = await prisma.eventRecord.create({ data });
  return { action: 'created' as const, eventRecord: created };
}

export async function syncDailyCollectionEvents(inputs: DailyEventInput[]) {
  let created = 0;
  let updated = 0;
  for (const input of inputs) {
    const result = await syncDailyCollectionEvent(input);
    if (result.action === 'created') created += 1;
    else updated += 1;
  }
  return { created, updated };
}
