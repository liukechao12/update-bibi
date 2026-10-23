import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

/**
 * 录入后台进度：前端上传后立即拿到 recordIds，再轮询这里。
 *
 * 按记录 ID 统计而不是按批次：Excel 里"更新已有记录"的那几条 batchId 仍指向它们
 * 最初的批次，按批次统计会漏掉它们。
 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : [];
  if (ids.length === 0) {
    return NextResponse.json({ code: 40002, message: '缺少 ids' }, { status: 400 });
  }
  if (ids.length > 2000) {
    return NextResponse.json({ code: 40002, message: '单次最多查询 2000 条' }, { status: 400 });
  }

  const isSuperAdmin = auth.user.roles?.includes('SUPER_ADMIN');
  const records = await prisma.dataRecord.findMany({
    where: { id: { in: ids } },
    select: { id: true, recordStatus: true, createdById: true }
  });
  const visible = isSuperAdmin ? records : records.filter((record) => record.createdById === auth.user.id);

  const images = await prisma.recordImage.findMany({
    where: { recordId: { in: visible.map((record) => record.id) } },
    select: { recordId: true, uploadStatus: true }
  });
  const uploaded = new Set<string>();
  const failed = new Set<string>();
  for (const image of images) {
    if (image.uploadStatus === 'UPLOADED') uploaded.add(image.recordId);
    else if (image.uploadStatus === 'FAILED') failed.add(image.recordId);
  }

  // 只算本批新建记录的截图：有成功图的算完成，只有失败记录的算已放弃，其余仍在截图队列里。
  const screenshotDone = visible.filter((record) => uploaded.has(record.id)).length;
  const screenshotFailed = visible.filter((record) => !uploaded.has(record.id) && failed.has(record.id)).length;
  const screenshotPending = visible.length - screenshotDone - screenshotFailed;

  const statusCount = visible.reduce<Record<string, number>>((acc, record) => {
    acc[record.recordStatus] = (acc[record.recordStatus] ?? 0) + 1;
    return acc;
  }, {});
  const pushSuccess = statusCount.SUCCESS ?? 0;
  const pushFailed = statusCount.FAILED ?? 0;
  const pushing = (statusCount.PUSHING ?? 0) + (statusCount.RETRYING ?? 0);
  const pushPending = statusCount.PENDING_PUSH ?? 0;

  return NextResponse.json({
    total: visible.length,
    screenshot: { done: screenshotDone, failed: screenshotFailed, pending: screenshotPending },
    push: { success: pushSuccess, failed: pushFailed, pushing, pending: pushPending },
    // 截图队列清空且没有待推送/在途记录 = 后台全部跑完
    finished: screenshotPending === 0 && pushPending === 0 && pushing === 0
  });
}
