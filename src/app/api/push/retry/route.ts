import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { pushExistingRecords } from '@/lib/push-workflow';

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const jobId = body?.jobId;
  if (typeof jobId !== 'string' || !jobId.trim()) {
    return NextResponse.json({ code: 40002, message: '缺少有效的 jobId' }, { status: 400 });
  }

  const job = await prisma.pushJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ code: 40400, message: '推送任务不存在' }, { status: 404 });
  }
  if (!auth.user.roles?.includes('SUPER_ADMIN') && job.createdById !== auth.user.id) {
    return NextResponse.json({ code: 40301, message: '无权限' }, { status: 403 });
  }

  const items = await prisma.pushJobItem.findMany({
    where: { pushJobId: job.id, status: 'FAILED' },
    select: { recordId: true }
  });
  if (!items.length) {
    return NextResponse.json({ code: 40003, message: '该任务无失败明细可重推，请核对任务状态' }, { status: 400 });
  }

  try {
    const result = await pushExistingRecords(auth.user.id, [...new Set(items.map((item) => item.recordId))]);
    await prisma.pushJob.update({ where: { id: job.id }, data: { retryCount: { increment: 1 } } });
    const failed = result.results.reduce((sum, item) => sum + item.failed, 0);
    return NextResponse.json(
      { ok: failed === 0, result, message: failed ? `重推完成，仍有 ${failed} 条失败，请查看新任务详情` : result.message ?? '重推完成' },
      { status: failed ? 502 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : '重推失败' },
      { status: 500 }
    );
  }
}
