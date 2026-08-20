import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const recordIds = Array.isArray(body?.recordIds) ? body.recordIds.map((item: unknown) => String(item)) : [];

  if (recordIds.length === 0) {
    return NextResponse.json({ code: 40002, message: '缺少 recordIds' }, { status: 400 });
  }

  const records = await prisma.dataRecord.findMany({
    where: {
      id: { in: recordIds },
      recordStatus: 'PENDING_PUSH',
      ...(auth.user.roles?.includes('SUPER_ADMIN') ? {} : { createdById: auth.user.id })
    },
    select: { id: true }
  });

  if (records.length === 0) {
    return NextResponse.json({ code: 40003, message: '没有可删除的待推送记录' }, { status: 400 });
  }

  await prisma.dataRecord.deleteMany({ where: { id: { in: records.map((item) => item.id) } } });

  return NextResponse.json({ ok: true, deletedCount: records.length });
}
