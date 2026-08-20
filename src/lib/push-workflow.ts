import { prisma } from '@/lib/prisma';
import { pushBatch } from '@/lib/push';
import { PushRecordInput } from '@/lib/schemas';
import { getPushConfig } from '@/lib/push-config';

type PushError = { index: number; error: string; code?: string | number | null };

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
    publishTime: record.publishTime.toISOString().slice(0, 19).replace('T', ' '),
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
        errorMessage: failure?.error ?? null,
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

async function runPushWithTimeout(records: ReturnType<typeof toPushPayload>[], pushJobId: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = await pushBatch(records, undefined, { signal: controller.signal });
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
      batchNo: `BATCH-${Date.now()}`,
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
        publishTime: new Date(record.publishTime.replace(' ', 'T')),
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

export async function pushExistingRecords(userId: string, recordIds: string[]) {
  const currentUser = await getCurrentUserWithRoles(userId);
  if (!currentUser) throw new Error('未找到当前用户');

  const records = await prisma.dataRecord.findMany({
    where: { id: { in: recordIds } },
    include: { pushItems: { select: { status: true } } },
    orderBy: { createdAt: 'asc' }
  });

  if (records.length === 0) throw new Error('没有可推送的记录');

  const alreadySuccessfulRecords = records.filter((record) =>
    record.recordStatus === 'SUCCESS' || record.pushItems.some((item) => item.status === 'SUCCESS')
  );
  const pushing = records.filter((record) =>
    record.recordStatus === 'PUSHING' || record.pushItems.some((item) => item.status === 'SENDING' || item.status === 'RETRYING')
  );

  if (pushing.length > 0) {
    const blocked = pushing.map((record) => `${record.textId}(推送中)`);
    throw new Error(`以下记录不能重复推送：${blocked.join('、')}`);
  }

  if (alreadySuccessfulRecords.length > 0) {
    await prisma.dataRecord.updateMany({
      where: { id: { in: alreadySuccessfulRecords.map((record) => record.id) } },
      data: { recordStatus: 'SUCCESS' }
    });
  }

  const pushableRecords = records.filter((record) => !alreadySuccessfulRecords.some((item) => item.id === record.id));

  if (pushableRecords.length === 0) {
    return {
      batchNo: null,
      results: [],
      batchId: null,
      skipped: alreadySuccessfulRecords.length,
      message: `已成功的记录已直接标记为成功，未重复推送 ${alreadySuccessfulRecords.length} 条`
    };
  }

  if (!currentUser.roles?.some((item) => item.role.roleCode === 'SUPER_ADMIN')) {
    const unauthorized = records.find((record) => record.createdById !== currentUser.id);
    if (unauthorized) throw new Error('无权限推送其他人的记录');
  }

  const pushBatchRecord = await prisma.dataBatch.create({
    data: {
      batchNo: `PUSH-${Date.now()}`,
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
      jobNo: `JOB-${Date.now()}`,
      env: 'UAT',
      endpoint: process.env.VENDOR_API_BASE_URL ?? '',
      requestBody: { version: '1', records: pushableRecords.map((record) => toPushPayload(record)) },
      status: 'SENDING',
      createdById: currentUser.id
    }
  });

  await prisma.pushJobItem.createMany({
    data: pushableRecords.map((record, index) => ({
      pushJobId: pushJob.id,
      recordId: record.id,
      itemIndex: index + 1,
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
    const { payload, timedOut } = await runPushWithTimeout(pushableRecords.map((record) => toPushPayload(record)), pushJob.id, pushConfig.timeoutMs);

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

      await prisma.dataRecord.updateMany({
        where: { id: { in: alreadySuccessfulRecords.map((record) => record.id) } },
        data: { recordStatus: 'SUCCESS' }
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
