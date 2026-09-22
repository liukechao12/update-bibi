import { NextResponse } from 'next/server';
import { pushRequestSchema } from '@/lib/schemas';
import { buildVendorPushPayload, mapPushFailures, pushBatch, resolveEndpoint } from '@/lib/push';
import { getPushConfig } from '@/lib/push-config';
import { prisma } from '@/lib/prisma';
import { chunkRecords, normalizePublishTimeToDate } from '@/lib/mapping';
import { Prisma } from '@prisma/client';
import { requireApiUser } from '@/lib/api-auth';
import { pushExistingRecords } from '@/lib/push-workflow';
import { generateBatchNo, generateJobNo } from '@/lib/business-no';

type PushError = { index: number; error: string; code?: string | number | null };

const MAX_ERROR_MESSAGE_LENGTH = 60000;

function normalizeErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? '推送失败');
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}\n[错误详情已截断]`
    : message;
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));

  if (Array.isArray(body?.recordIds) && body.recordIds.length > 0) {
    try {
      const result = await pushExistingRecords(auth.user.id, body.recordIds.map((item: unknown) => String(item)));
      return NextResponse.json({
        batchNo: result.batchNo,
        batches: result.results.length,
        results: result.results
      });
    } catch (error) {
      return NextResponse.json({ code: 50000, message: error instanceof Error ? error.message : '推送失败' }, { status: 500 });
    }
  }

  const parsed = pushRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ code: 40002, message: parsed.error.issues[0]?.message ?? '请求体校验失败' }, { status: 400 });
  }

  const currentUser = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!currentUser) {
    return NextResponse.json({ code: 50000, message: '未找到当前用户' }, { status: 500 });
  }

  const batchGroups = chunkRecords(parsed.data.records, Math.max(1, (await getPushConfig()).batchSize));
  const results: Array<{ jobNo: string; inserted: number; failed: number; errors: PushError[] }> = [];
  const dataBatch = await prisma.dataBatch.create({
    data: {
      batchNo: generateBatchNo(),
      importType: 'PASTE',
      totalCount: parsed.data.records.length,
      validCount: parsed.data.records.length,
      invalidCount: 0,
      createdById: currentUser.id,
      status: 'PENDING_PUSH'
    }
  });

  const uniqueRecords = parsed.data.records.filter((record, index, list) => index === list.findIndex((item) => item.textId === record.textId));

  await prisma.dataRecord.createMany({
    data: uniqueRecords.map((record, index) => ({
      batchId: dataBatch.id,
      textId: record.textId,
      title: record.title,
      text: record.text,
      publishTime: normalizePublishTimeToDate(record.publishTime),
      author: record.author,
      originType: record.originType,
      publisherType: record.publisherType,
      authorType: record.authorType,
      url: record.url,
      commentNum: record.commentNum,
      forwardNum: record.forwardNum,
      praiseNum: record.praiseNum,
      viewNum: record.viewNum,
      recordStatus: 'VALIDATED',
      createdById: currentUser.id,
      sourceRowNo: index + 1
    })),
    skipDuplicates: true
  });

  const persistedRecords = await prisma.dataRecord.findMany({
    where: { batchId: dataBatch.id },
    orderBy: { createdAt: 'asc' }
  });

  const endpoint = await resolveEndpoint('CREATE');

  for (let index = 0; index < batchGroups.length; index += 1) {
    const group = batchGroups[index];
    const pushJob = await prisma.pushJob.create({
      data: {
        batchId: dataBatch.id,
        jobNo: `${generateJobNo()}-${index + 1}`,
        env: 'UAT',
        endpoint,
        requestBody: await buildVendorPushPayload(group),
        status: 'SENDING',
        createdById: currentUser.id
      }
    });

    await prisma.pushJobItem.createMany({
      data: group.map((record, itemIndex) => {
        const saved = persistedRecords.find((item) => item.textId === record.textId);
        return {
          pushJobId: pushJob.id,
          recordId: saved?.id ?? persistedRecords[itemIndex]?.id ?? '',
          itemIndex: itemIndex + 1,
          status: 'SENDING'
        };
      }).filter((item) => item.recordId)
    });

    try {
      const result = await pushBatch(group);
      const responseItems = (Array.isArray(result.errors) ? result.errors : []) as PushError[];
      await prisma.pushJob.update({
        where: { id: pushJob.id },
        data: {
          responseBody: result,
          httpStatus: 200,
          insertedCount: result.inserted,
          failedCount: result.failed,
          status: result.failed > 0 ? 'FAILED' : 'SUCCESS'
        }
      });
      results.push({ jobNo: pushJob.jobNo, inserted: result.inserted, failed: result.failed, errors: responseItems });

      const itemRecords = await prisma.pushJobItem.findMany({ where: { pushJobId: pushJob.id }, orderBy: { itemIndex: 'asc' } });
      const failures = mapPushFailures(result, itemRecords.length);
      for (let i = 0; i < itemRecords.length; i += 1) {
        const item = itemRecords[i];
        const failure = failures.get(i);
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
          data: {
            recordStatus: failure ? 'FAILED' : 'SUCCESS'
          }
        });
      }
    } catch (error) {
      await prisma.pushJob.update({
        where: { id: pushJob.id },
        data: {
          responseBody: { error: error instanceof Error ? error.message : '推送失败' },
          httpStatus: 500,
          status: 'FAILED'
        }
      });
      results.push({
        jobNo: pushJob.jobNo,
        inserted: 0,
        failed: group.length,
        errors: [{ index: 0, error: error instanceof Error ? error.message : '推送失败' }]
      });

      const itemRecords = await prisma.pushJobItem.findMany({ where: { pushJobId: pushJob.id }, orderBy: { itemIndex: 'asc' } });
      for (const item of itemRecords) {
        await prisma.pushJobItem.update({
          where: { id: item.id },
          data: {
            status: 'FAILED',
            errorMessage: normalizeErrorMessage(error),
          }
        });
        await prisma.dataRecord.update({
          where: { id: item.recordId },
          data: {
            recordStatus: 'FAILED'
          }
        });
      }
    }
  }

  await prisma.dataBatch.update({
    where: { id: dataBatch.id },
    data: {
      status: results.some((item) => item.failed > 0) ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      pushedAt: new Date(),
      pushCount: results.length,
      successCount: results.filter((item) => item.failed === 0).length,
      failCount: results.filter((item) => item.failed > 0).length
    }
  });

  return NextResponse.json({
    batchNo: dataBatch.batchNo,
    batches: results.length,
    results
  });
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '';
  const userId = searchParams.get('userId') ?? '';
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';

  const where: Prisma.PushJobWhereInput = {};

  if (status) {
    where.status = status as unknown as Prisma.EnumPushJobStatusFilter;
  }
  if (userId) {
    where.createdById = userId;
  } else if (!auth.user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = auth.user.id;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59`);
  }

  const jobs = await prisma.pushJob.findMany({
    where,
    include: {
      batch: true,
      createdBy: true
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return NextResponse.json({ jobs });
}
