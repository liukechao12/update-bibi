import { PushResponse } from '@/lib/types';
import { prisma } from '@/lib/prisma';
import { buildVendorPushPayload, decidePushType, pushBatch, OutgoingPushRecord } from '@/lib/push';
import { PushRecordInput } from '@/lib/schemas';
import { normalizePublishTimeToDate } from '@/lib/mapping';
import { getPushConfig } from '@/lib/push-config';
import { generateBatchNo, generateJobNo } from '@/lib/business-no';
import { applyMetricCapability, loadMetricCapabilityMap } from '@/lib/metric-capability';

type PushError = { index: number; error: string; code?: string | number | null };

const MAX_ERROR_MESSAGE_LENGTH = 60000;

function normalizeErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? '推送失败');
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}\n[错误详情已截断]`
    : message;
}

function toPushPayload(record: {
  textId: string;
  title: string;
  text: string;
  publishTime: Date;
  author: string;
  originType: string;
  publisherType: string;
  authorType: string | null;
  url: string;
  commentNum: number;
  forwardNum: number | null;
  praiseNum: number | null;
  viewNum: number | null;
}): PushRecordInput {
  return {
    textId: record.textId,
    title: record.title,
    text: record.text,
    publishTime: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(record.publishTime),
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
  return prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } }
  });
}

async function writePushResult(pushJobId: string, payload: Awaited<ReturnType<typeof pushBatch>>) {
  const pushItems = await prisma.pushJobItem.findMany({ where: { pushJobId }, orderBy: { itemIndex: 'asc' } });
  const errors = (payload.errors ?? []) as PushError[];

  await prisma.pushJob.update({
    where: { id: pushJobId },
    data: {
      responseBody: payload,
      httpStatus: 200,
      insertedCount: payload.inserted,
      failedCount: payload.failed,
      status: payload.failed > 0 ? 'FAILED' : 'SUCCESS'
    }
  });

  for (let i = 0; i < pushItems.length; i += 1) {
    const item = pushItems[i];
    const failure = errors.find((entry) => entry.index === i);
    await prisma.pushJobItem.update({
      where: { id: item.id },
      data: {
        status: failure ? 'FAILED' : 'SUCCESS',
        errorMessage: failure ? normalizeErrorMessage(failure.error) : null,
        vendorResponseCode: failure?.code != null ? String(failure.code) : null
      }
    });
    await prisma.dataRecord.update({
      where: { id: item.recordId },
      data: { recordStatus: failure ? 'FAILED' : 'SUCCESS' }
    });
  }
}

async function settleTransientStatuses(params: { recordIds: string[]; batchId: string; pushJobId: string; timeoutReason?: string }) {
  const lingeringRecords = await prisma.dataRecord.findMany({
    where: { id: { in: params.recordIds }, recordStatus: 'PUSHING' },
    select: { id: true }
  });
  if (lingeringRecords.length > 0) {
    await prisma.dataRecord.updateMany({
      where: { id: { in: lingeringRecords.map((record) => record.id) } },
      data: { recordStatus: 'FAILED' }
    });
  }

  const pushJob = await prisma.pushJob.findUnique({ where: { id: params.pushJobId }, select: { status: true } });
  if (pushJob && ['SENDING', 'RETRYING'].includes(pushJob.status)) {
    await prisma.pushJob.update({
      where: { id: params.pushJobId },
      data: {
        status: 'FAILED',
        responseBody: params.timeoutReason ? { error: params.timeoutReason } : undefined,
        httpStatus: params.timeoutReason ? 504 : undefined,
        failedCount: params.recordIds.length
      }
    });
  }

  const batch = await prisma.dataBatch.findUnique({ where: { id: params.batchId }, select: { status: true } });
  if (batch && batch.status === 'PUSHING') {
    await prisma.dataBatch.update({
      where: { id: params.batchId },
      data: {
        status: 'FAILED',
        pushedAt: new Date(),
        pushCount: 1,
        successCount: 0,
        failCount: 1,
        remark: params.timeoutReason ?? '推送超时'
      }
    });
  }
}

async function runPushWithTimeout(records: OutgoingPushRecord[], pushJobId: string, timeoutMs: number, pushType: 'CREATE' | 'UPDATE') {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = await pushBatch(records, undefined, { signal: controller.signal, pushType });
    return { payload, timedOut: false };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { payload: null, timedOut: true };
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function saveParsedRecordsOnly(userId: string, records: PushRecordInput[]) {
  const currentUser = await getCurrentUserWithRoles(userId);
  if (!currentUser) throw new Error('未找到当前用户');

  const uniqueRecords = records.filter((record, index, list) => index === list.findIndex((item) => item.textId === record.textId));

  const batch = await prisma.dataBatch.create({
    data: {
      batchNo: generateBatchNo(),
      importType: 'PASTE',
      totalCount: uniqueRecords.length,
      validCount: uniqueRecords.length,
      invalidCount: 0,
      createdById: currentUser.id,
      status: 'PENDING_PUSH',
      remark: '粘贴解析保存'
    }
  });

  const createdRecords = [] as Array<{ id: string; textId: string }>;
  for (let index = 0; index < uniqueRecords.length; index += 1) {
    const record = uniqueRecords[index];
    const saved = await prisma.dataRecord.create({
      data: {
        batchId: batch.id,
        textId: record.textId,
        title: record.title,
        text: record.text,
        publishTime: normalizePublishTimeToDate(record.publishTime),
        author: record.author,
        originType: record.originType,
        url: record.url,
        commentNum: record.commentNum,
        forwardNum: record.forwardNum,
        praiseNum: record.praiseNum,
        viewNum: record.viewNum,
        recordStatus: 'PENDING_PUSH',
        createdById: currentUser.id,
        rawSourceText: JSON.stringify(record),
        sourceRowNo: index + 1
      }
    });
    createdRecords.push({ id: saved.id, textId: saved.textId });
  }

  return { batch, createdRecords };
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

  const records = await prisma.dataRecord.findMany({
    where: { id: { in: recordIds } },
    include: { 
      pushItems: { 
        select: { 
          status: true,
          pushType: true,
          previousCommentNum: true,
          previousForwardNum: true,
          previousPraiseNum: true,
          previousViewNum: true
        },
        orderBy: { createdAt: 'desc' }
      } 
    },
    orderBy: { createdAt: 'asc' }
  });

  if (records.length === 0) throw new Error('没有可推送的记录');

  const pushing = records.filter((record) =>
    record.recordStatus === 'PUSHING' || record.pushItems.some((item) => item.status === 'SENDING' || item.status === 'RETRYING')
  );

  if (pushing.length > 0) {
    const blocked = pushing.map((record) => `${record.textId}(推送中)`);
    throw new Error(`以下记录不能重复推送：${blocked.join('、')}`);
  }

  const classified = records.map((record) => ({
    record,
    pushType: record.recordStatus === 'PENDING_PUSH'
      ? (record.pushItems.some((item) => item.status === 'SUCCESS') ? 'UPDATE' : 'CREATE')
      : decidePushType(record)
  }));
  const createIds = classified.filter((item) => item.pushType === 'CREATE').map((item) => item.record.id);
  const updateIds = classified.filter((item) => item.pushType === 'UPDATE').map((item) => item.record.id);
  const skipCount = classified.filter((item) => item.pushType === 'SKIP').length;

  // 新增和更新接口的请求结构不同，混合选择时拆成两个独立任务。
  if (createIds.length > 0 && updateIds.length > 0) {
    const grouped: ExistingPushResult[] = await Promise.all([
      pushExistingRecords(userId, createIds),
      pushExistingRecords(userId, updateIds)
    ]);
    return {
      batchNo: grouped.map((item) => item.batchNo).filter(Boolean).join(', ') || null,
      results: grouped.flatMap((item) => item.results),
      batchId: grouped.map((item) => item.batchId).filter(Boolean).join(', ') || null,
      skipped: skipCount,
      message: `新增 ${createIds.length} 条，更新 ${updateIds.length} 条，跳过 ${skipCount} 条未变化数据`
    };
  }

  const pushableRecords = classified.filter((item) => item.pushType !== 'SKIP').map((item) => item.record);
  if (pushableRecords.length === 0) {
    return {
      batchNo: null,
      results: [],
      batchId: null,
      skipped: skipCount,
      message: `数据未发生变化，未重复推送 ${skipCount} 条`
    };
  }

  const pushType = classified.find((item) => item.pushType !== 'SKIP')?.pushType === 'UPDATE' ? 'UPDATE' as const : 'CREATE' as const;
  const capabilityMap = await loadMetricCapabilityMap();
  const outgoingRecords = pushableRecords.map((record) =>
    applyMetricCapability(toPushPayload(record), record.sourceName, capabilityMap)
  );
  const recordsWithPushType = pushableRecords.map((record) => {
    const latestSuccess = record.pushItems.find((item) => item.status === 'SUCCESS');
    return {
      ...record,
      determinedPushType: decidePushType(record) === 'UPDATE' ? 'UPDATE' as const : 'CREATE' as const,
      previousCommentNum: latestSuccess?.previousCommentNum ?? null,
      previousForwardNum: latestSuccess?.previousForwardNum ?? null,
      previousPraiseNum: latestSuccess?.previousPraiseNum ?? null,
      previousViewNum: latestSuccess?.previousViewNum ?? null
    };
  });

  if (!currentUser.roles?.some((item) => item.role.roleCode === 'SUPER_ADMIN')) {
    const unauthorized = records.find((record) => record.createdById !== currentUser.id);
    if (unauthorized) throw new Error('无权限推送其他人的记录');
  }

  const pushBatchRecord = await prisma.dataBatch.create({
    data: {
      batchNo: generateBatchNo('PUSH'),
      importType: 'MANUAL',
      totalCount: pushableRecords.length,
      validCount: pushableRecords.length,
      invalidCount: 0,
      createdById: currentUser.id,
      status: 'PUSHING',
      remark: pushableRecords.length > 1 ? '多批次记录混合推送' : '单条记录推送'
    }
  });

  const pushJob = await prisma.pushJob.create({
    data: {
      batchId: pushBatchRecord.id,
      jobNo: generateJobNo(),
      env: 'UAT',
      endpoint: pushType === 'UPDATE'
        ? (process.env.VENDOR_API_BASE_URL ?? '').replace(/\/messages$/, '/messages/revisions')
        : (process.env.VENDOR_API_BASE_URL ?? ''),
      pushType,
      requestBody: await buildVendorPushPayload(outgoingRecords, pushType),
      status: 'SENDING',
      createdById: currentUser.id
    }
  });

  await prisma.pushJobItem.createMany({
    data: recordsWithPushType.map((record, index) => ({
      pushJobId: pushJob.id,
      recordId: record.id,
      itemIndex: index + 1,
      pushType: record.determinedPushType,
      previousCommentNum: record.commentNum,
      previousForwardNum: record.forwardNum,
      previousPraiseNum: record.praiseNum,
      previousViewNum: record.viewNum,
      status: 'SENDING'
    }))
  });

  await prisma.dataRecord.updateMany({
    where: { id: { in: pushableRecords.map((record) => record.id) } },
    data: { recordStatus: 'PUSHING' }
  });

  const pushConfig = await getPushConfig();
  const timeoutReason = `推送超时，超过 ${Math.round(pushConfig.timeoutMs / 1000)} 秒未完成`;

  try {
    const { payload, timedOut } = await runPushWithTimeout(
      outgoingRecords, 
      pushJob.id, 
      pushConfig.timeoutMs,
      pushType
    );

    if (timedOut) {
      await prisma.pushJob.update({
        where: { id: pushJob.id },
        data: {
          responseBody: { error: timeoutReason },
          httpStatus: 504,
          failedCount: pushableRecords.length,
          status: 'FAILED'
        }
      });

      await prisma.pushJobItem.updateMany({
        where: { pushJobId: pushJob.id },
        data: {
          status: 'FAILED',
          errorMessage: timeoutReason
        }
      });

      await prisma.dataRecord.updateMany({
        where: { id: { in: pushableRecords.map((record) => record.id) } },
        data: { recordStatus: 'FAILED' }
      });

      await prisma.dataBatch.update({
        where: { id: pushBatchRecord.id },
        data: {
          status: 'FAILED',
          pushedAt: new Date(),
          pushCount: 1,
          successCount: 0,
          failCount: 1,
          remark: timeoutReason
        }
      });

      throw new Error(timeoutReason);
    }

    if (!payload) {
      throw new Error(timeoutReason);
    }

    await writePushResult(pushJob.id, payload);

    await prisma.dataBatch.update({
      where: { id: pushBatchRecord.id },
      data: {
        status: payload.failed > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
        pushedAt: new Date(),
        pushCount: 1,
        successCount: payload.failed > 0 ? 0 : 1,
        failCount: payload.failed > 0 ? 1 : 0
      }
    });

    return { batchNo: pushBatchRecord.batchNo, results: [payload], batchId: pushBatchRecord.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '推送失败';

    await prisma.pushJob.update({
      where: { id: pushJob.id },
      data: {
        responseBody: { error: errorMessage },
        httpStatus: errorMessage.includes('超时') ? 504 : 500,
        failedCount: pushableRecords.length,
        status: 'FAILED'
      }
    });

    await prisma.pushJobItem.updateMany({
      where: { pushJobId: pushJob.id },
      data: {
        status: 'FAILED',
        errorMessage
      }
    });

    await prisma.dataRecord.updateMany({
      where: { id: { in: records.map((record) => record.id) } },
      data: { recordStatus: 'FAILED' }
    });

    await prisma.dataBatch.update({
      where: { id: pushBatchRecord.id },
      data: {
        status: 'FAILED',
        pushedAt: new Date(),
        pushCount: 1,
        successCount: 0,
        failCount: 1,
        remark: errorMessage
      }
    });

    throw error;
  } finally {
    await settleTransientStatuses({
      recordIds: records.map((record) => record.id),
      batchId: pushBatchRecord.id,
      pushJobId: pushJob.id,
      timeoutReason
    });
  }
}
