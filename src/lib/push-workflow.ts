import { PushResponse } from '@/lib/types';
import { prisma } from '@/lib/prisma';
import { buildVendorPushPayload, decidePushType, mapPushFailures, pushBatch, resolveEndpoint, OutgoingPushRecord } from '@/lib/push';
import { PushRecordInput, pushRecordSchema } from '@/lib/schemas';
import { normalizeContentUrl, normalizePublishTimeToDate } from '@/lib/mapping';
import { getPushConfig } from '@/lib/push-config';
import { generateBatchNo, generateJobNo } from '@/lib/business-no';
import { applyMetricCapability, loadMetricCapabilityMap } from '@/lib/metric-capability';
import { BatchStatus } from '@prisma/client';

function normalizeErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? '推送失败');
  return message.length > 60000 ? `${message.slice(0, 60000)}\n[错误详情已截断]` : message;
}

function toPushPayload(record: {
  textId: string; title: string; text: string; publishTime: Date; crawlTime: Date | null; createdAt: Date;
  author: string; originType: string; publisherType: string; authorType: string | null; url: string;
  commentNum: number; forwardNum: number | null; praiseNum: number | null; viewNum: number | null;
}): PushRecordInput {
  return {
    textId: record.textId,
    title: record.title,
    text: record.text,
    publishTime: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(record.publishTime),
    // 历史数据缺少采集时间时，入库时间仅作为固定估算值，不随重推改变。
    crawlTime: (record.crawlTime ?? record.createdAt).toISOString(),
    author: record.author,
    originType: record.originType as PushRecordInput['originType'],
    publisherType: record.publisherType as PushRecordInput['publisherType'],
    authorType: record.authorType as PushRecordInput['authorType'],
    url: record.url,
    commentNum: record.commentNum,
    forwardNum: record.forwardNum,
    praiseNum: record.praiseNum,
    viewNum: record.viewNum
  };
}

async function getCurrentUserWithRoles(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
}

async function writePushResult(pushJobId: string, payload: PushResponse) {
  const items = await prisma.pushJobItem.findMany({ where: { pushJobId }, orderBy: { itemIndex: 'asc' } });
  const failures = mapPushFailures(payload, items.length);
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const failure = failures.get(item.itemIndex - 1);
      await tx.pushJobItem.update({
        where: { id: item.id },
        data: {
          status: failure ? 'FAILED' : 'SUCCESS',
          errorMessage: failure ? normalizeErrorMessage(failure.error) : null,
          vendorResponseCode: failure?.code != null ? String(failure.code) : null
        }
      });
    }
    for (const failed of [false, true]) {
      const ids = items.filter((item) => failures.has(item.itemIndex - 1) === failed).map((item) => item.recordId);
      if (ids.length) await tx.dataRecord.updateMany({
        where: { id: { in: ids }, recordStatus: 'PUSHING' },
        data: { recordStatus: failed ? 'FAILED' : 'SUCCESS' }
      });
    }
    await tx.pushJob.update({
      where: { id: pushJobId },
      data: {
        responseBody: payload, httpStatus: payload.httpStatus ?? 200, insertedCount: items.length - failures.size,
        failedCount: failures.size, status: failures.size ? 'FAILED' : 'SUCCESS'
      }
    });
  }, { timeout: 60000 });
}

async function markChunkFailed(pushJobId: string, recordIds: string[], message: string, httpStatus: number) {
  await prisma.$transaction(async (tx) => {
    await tx.pushJob.update({
      where: { id: pushJobId },
      data: { responseBody: { error: message }, httpStatus, insertedCount: 0, failedCount: recordIds.length, status: 'FAILED' }
    });
    await tx.pushJobItem.updateMany({ where: { pushJobId }, data: { status: 'FAILED', errorMessage: message } });
    await tx.dataRecord.updateMany({ where: { id: { in: recordIds }, recordStatus: 'PUSHING' }, data: { recordStatus: 'FAILED' } });
  });
}

async function refreshImportBatchStatuses(batchIds: string[]) {
  const groups = await prisma.dataRecord.groupBy({
    by: ['batchId', 'recordStatus'], where: { batchId: { in: batchIds } }, _count: { _all: true }
  });
  for (const batchId of batchIds) {
    const states = groups.filter((group) => group.batchId === batchId).map((group) => group.recordStatus);
    if (!states.length) continue;
    const status: BatchStatus = states.includes('PUSHING') || states.includes('RETRYING') ? 'PUSHING'
      : states.every((state) => state === 'SUCCESS') ? 'SUCCESS'
      : states.every((state) => state === 'FAILED') ? 'FAILED'
      : states.includes('PENDING_PUSH') || states.includes('VALIDATED') || states.includes('DRAFT') ? 'PENDING_PUSH'
      : 'PARTIAL_SUCCESS';
    await prisma.dataBatch.update({ where: { id: batchId }, data: { status } });
  }
}

export async function saveParsedRecordsOnly(userId: string, input: PushRecordInput[]) {
  const receivedAt = new Date();
  const currentUser = await getCurrentUserWithRoles(userId);
  if (!currentUser) throw new Error('未找到当前用户');
  const isAdmin = currentUser.roles.some((item) => item.role.roleCode === 'SUPER_ADMIN');
  const records = input.map((record) => pushRecordSchema.parse({ ...record, url: normalizeContentUrl(record.url) }));
  return prisma.$transaction(async (tx) => {
    const batch = await tx.dataBatch.create({
      data: { batchNo: generateBatchNo(), importType: 'PASTE', totalCount: records.length, validCount: 0, invalidCount: 0, createdById: userId, status: 'PENDING_PUSH', remark: '直接提交保存' }
    });
    const createdRecords: Array<{ id: string; textId: string }> = [];
    for (const [index, record] of records.entries()) {
      const existing = await tx.dataRecord.findFirst({
        where: { OR: [{ textId: record.textId }, { url: record.url }] }, orderBy: { createdAt: 'asc' }
      });
      if (existing && !isAdmin && existing.createdById !== userId) throw new Error('无权限修改其他人的记录');
      if (existing && ['PUSHING', 'RETRYING'].includes(existing.recordStatus)) throw new Error(`${existing.textId} 正在推送，请稍后再提交`);
      const content = {
        title: record.title, text: record.text, publishTime: normalizePublishTimeToDate(record.publishTime),
        author: record.author, originType: record.originType, publisherType: record.publisherType,
        authorType: record.authorType, url: record.url, commentNum: record.commentNum,
        forwardNum: record.forwardNum, praiseNum: record.praiseNum, viewNum: record.viewNum
      };
      const changed = !existing || Object.entries(content).some(([key, value]) => {
        const previous = existing[key as keyof typeof content];
        return value instanceof Date && previous instanceof Date ? value.getTime() !== previous.getTime() : value !== previous;
      });
      const data = {
        ...content, crawlTime: record.crawlTime ? new Date(record.crawlTime) : receivedAt,
        rawSourceText: JSON.stringify({ ...record, textId: existing?.textId ?? record.textId }),
        sourceRowNo: index + 1, recordStatus: 'PENDING_PUSH' as const
      };
      let saved = existing;
      if (!existing) {
        saved = await tx.dataRecord.create({ data: { ...data, batchId: batch.id, textId: record.textId, createdById: userId } });
      } else if (changed) {
        const updated = await tx.dataRecord.updateMany({
          where: { id: existing.id, updatedAt: existing.updatedAt, recordStatus: existing.recordStatus }, data
        });
        if (updated.count !== 1) throw new Error('记录状态已变化，请刷新后重试');
      }
      if (saved && !createdRecords.some((item) => item.id === saved.id)) createdRecords.push({ id: saved.id, textId: saved.textId });
    }
    await tx.dataBatch.update({ where: { id: batch.id }, data: { validCount: createdRecords.length } });
    return { batch, createdRecords };
  }, { timeout: 60000 });
}

type ExistingPushResult = {
  batchNo: string | null;
  results: PushResponse[];
  batchId: string | null;
  skipped?: number;
  message?: string;
};

export async function pushExistingRecords(userId: string, recordIds: string[]): Promise<ExistingPushResult> {
  const currentUser = await getCurrentUserWithRoles(userId);
  if (!currentUser) throw new Error('未找到当前用户');
  const pushConfig = await getPushConfig();
  const activeAfter = new Date(Date.now() - pushConfig.timeoutMs - 60000);
  const records = await prisma.dataRecord.findMany({
    where: { id: { in: recordIds } },
    include: {
      pushItems: {
        select: {
          status: true, pushType: true, createdAt: true,
          previousCommentNum: true, previousForwardNum: true, previousPraiseNum: true, previousViewNum: true,
          pushJob: { select: { status: true, updatedAt: true } }
        },
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
  if (!records.length) throw new Error('没有可推送的记录');
  if (!currentUser.roles.some((item) => item.role.roleCode === 'SUPER_ADMIN') && records.some((record) => record.createdById !== userId)) {
    throw new Error('无权限推送其他人的记录');
  }
  const pushing = records.filter((record) => {
    const latestSuccess = record.pushItems.find((item) => item.status === 'SUCCESS');
    return (record.recordStatus === 'PUSHING' && record.updatedAt >= activeAfter) || record.pushItems.some((item) =>
      ['SENDING', 'RETRYING'].includes(item.status) && ['SENDING', 'RETRYING'].includes(item.pushJob.status) &&
      item.pushJob.updatedAt >= activeAfter && (!latestSuccess || latestSuccess.createdAt < item.createdAt)
    );
  });
  if (pushing.length) throw new Error(`以下记录不能重复推送：${pushing.map((record) => record.textId).join('、')}`);

  const classified = records.map((record) => ({ record, pushType: decidePushType(record) }));
  const createIds = classified.filter((item) => item.pushType === 'CREATE').map((item) => item.record.id);
  const updateIds = classified.filter((item) => item.pushType === 'UPDATE').map((item) => item.record.id);
  const skipCount = classified.filter((item) => item.pushType === 'SKIP').length;
  if (createIds.length && updateIds.length) {
    const grouped = [await pushExistingRecords(userId, createIds), await pushExistingRecords(userId, updateIds)];
    return {
      batchNo: grouped.map((item) => item.batchNo).filter(Boolean).join(', ') || null,
      results: grouped.flatMap((item) => item.results),
      batchId: grouped.map((item) => item.batchId).filter(Boolean).join(', ') || null,
      skipped: skipCount,
      message: `新增 ${createIds.length} 条，更新 ${updateIds.length} 条，跳过 ${skipCount} 条未变化数据`
    };
  }
  const pushable = classified.filter((item) => item.pushType !== 'SKIP').map((item) => item.record);
  if (!pushable.length) return { batchNo: null, results: [], batchId: null, skipped: skipCount, message: `数据未发生变化，未重复推送 ${skipCount} 条` };
  const pushType = updateIds.length ? 'UPDATE' as const : 'CREATE' as const;
  const endpoint = await resolveEndpoint(pushType);
  const capabilities = await loadMetricCapabilityMap();
  const chunks: Array<{ records: typeof pushable; outgoing: OutgoingPushRecord[]; requestBody: Awaited<ReturnType<typeof buildVendorPushPayload>> }> = [];
  for (let start = 0; start < pushable.length; start += pushConfig.batchSize) {
    const chunk = pushable.slice(start, start + pushConfig.batchSize);
    const outgoing = chunk.map((record) => applyMetricCapability(toPushPayload(record), record.sourceName, capabilities));
    chunks.push({ records: chunk, outgoing, requestBody: await buildVendorPushPayload(outgoing, pushType) });
  }
  const batch = await prisma.dataBatch.create({
    data: { batchNo: generateBatchNo('PUSH'), importType: 'MANUAL', totalCount: pushable.length, validCount: pushable.length, invalidCount: 0, createdById: userId, status: 'PUSHING' }
  });
  const results: PushResponse[] = [];
  try {
    for (const [index, chunk] of chunks.entries()) {
      const ids = chunk.records.map((record) => record.id);
      let jobId: string | undefined;
      try {
        const job = await prisma.$transaction(async (tx) => {
          const claimed = await tx.dataRecord.updateMany({
            where: { OR: chunk.records.map((record) => ({ id: record.id, updatedAt: record.updatedAt, recordStatus: record.recordStatus })) },
            data: { recordStatus: 'PUSHING' }
          });
          if (claimed.count !== ids.length) throw new Error('记录状态已变化，请刷新后重试');
          const created = await tx.pushJob.create({
            data: { batchId: batch.id, jobNo: `${generateJobNo()}-${index + 1}`, env: 'UAT', endpoint, pushType, requestBody: chunk.requestBody, status: 'SENDING', createdById: userId }
          });
          await tx.pushJobItem.createMany({
            data: chunk.records.map((record, itemIndex) => ({
              pushJobId: created.id, recordId: record.id, itemIndex: itemIndex + 1, pushType,
              previousCommentNum: record.commentNum, previousForwardNum: record.forwardNum,
              previousPraiseNum: record.praiseNum, previousViewNum: record.viewNum, status: 'SENDING'
            }))
          });
          return created;
        });
        jobId = job.id;
        const payload = await pushBatch(chunk.outgoing, undefined, { pushType });
        await writePushResult(job.id, payload);
        results.push(payload);
      } catch (error) {
        const timedOut = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
        const message = timedOut ? `推送超时，超过 ${Math.round(pushConfig.timeoutMs / 1000)} 秒未完成` : normalizeErrorMessage(error);
        const httpStatus = timedOut ? 504 : error instanceof Error && 'httpStatus' in error && typeof error.httpStatus === 'number' ? error.httpStatus : 500;
        if (jobId) await markChunkFailed(jobId, ids, message, httpStatus);
        results.push({ inserted: 0, failed: ids.length, httpStatus, errors: ids.map((_, itemIndex) => ({ index: itemIndex, error: message })) });
      }
    }
  } finally {
    const inserted = results.reduce((sum, result) => sum + result.inserted, 0);
    const failed = pushable.length - inserted;
    await prisma.dataBatch.update({
      where: { id: batch.id },
      data: {
        status: !inserted ? 'FAILED' : failed ? 'PARTIAL_SUCCESS' : 'SUCCESS', pushedAt: new Date(),
        pushCount: chunks.length, successCount: results.filter((result) => result.failed === 0).length,
        failCount: chunks.length - results.filter((result) => result.failed === 0).length,
        remark: `分 ${chunks.length} 片推送，成功 ${inserted} 条，失败 ${failed} 条`
      }
    });
    await refreshImportBatchStatuses([...new Set(pushable.map((record) => record.batchId))]);
  }
  return { batchNo: batch.batchNo, results, batchId: batch.id, skipped: skipCount };
}
