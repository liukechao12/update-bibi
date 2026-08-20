import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { pushExistingRecords } from '@/lib/push-workflow';

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { jobId } = await request.json().catch(() => ({}));
  if (!jobId) {
    return NextResponse.json({ code: 40002, message: '缺少 jobId' }, { status: 400 });
  }

  const job = await prisma.pushJob.findUnique({
    where: { id: String(jobId) },
    include: { batch: true }
  });

  if (!job) {
    return NextResponse.json({ code: 40400, message: '推送任务不存在' }, { status: 404 });
  }

  if (!auth.user.roles?.includes('SUPER_ADMIN') && job.createdById !== auth.user.id) {
    return NextResponse.json({ code: 40301, message: '无权限' }, { status: 403 });
  }

  const records = await prisma.dataRecord.findMany({ where: { batchId: job.batchId }, orderBy: { createdAt: 'asc' } });
  if (records.length === 0) {
    return NextResponse.json({ code: 40003, message: '该任务无可重推记录' }, { status: 400 });
  }

  await prisma.pushJob.update({
    where: { id: job.id },
    data: {
      retryCount: { increment: 1 },
      status: 'RETRYING'
    }
  });

  try {
    const result = await pushExistingRecords(auth.user.id, records.map((record) => record.id));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    await prisma.pushJob.update({
      where: { id: job.id },
      data: {
        responseBody: { error: error instanceof Error ? error.message : '重推失败' },
        httpStatus: 500,
        status: 'FAILED'
      }
    });

    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : '重推失败' },
      { status: 500 }
    );
  }
}
