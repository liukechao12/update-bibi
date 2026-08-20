import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { labelOrValue, pushJobStatusLabelMap } from '@/lib/labels';

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function resolveFailureReason(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== 'object') return '';
  const error = (responseBody as { error?: unknown }).error;
  return typeof error === 'string' ? error : '';
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '';
  const userId = searchParams.get('userId') ?? '';
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (userId) {
    where.createdById = userId;
  } else if (!auth.user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = auth.user.id;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
    if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(`${endDate}T23:59:59`);
  }

  const jobs = await prisma.pushJob.findMany({
    where: where as never,
    orderBy: { createdAt: 'desc' },
    include: { batch: true, createdBy: true }
  });

  const header = ['任务号', '批次号', '提交人', '状态', '成功', '失败', '环境', '失败原因', '创建时间'];
  const rows = jobs.map((job) => [
    job.jobNo,
    job.batch?.batchNo ?? '',
    job.createdBy?.displayName ?? '',
    labelOrValue(pushJobStatusLabelMap, job.status),
    job.insertedCount,
    job.failedCount,
    job.env,
    resolveFailureReason(job.responseBody),
    job.createdAt.toISOString()
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="push-jobs-export.csv"'
    }
  });
}
