import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const record = await prisma.dataRecord.findUnique({
    where: { id },
    include: { pushItems: true }
  });

  if (!record) {
    return NextResponse.json({ code: 40400, message: '记录不存在' }, { status: 404 });
  }

  if (record.recordStatus !== 'PENDING_PUSH') {
    return NextResponse.json({ code: 40003, message: '只有待推送记录可以删除' }, { status: 400 });
  }

  if (!auth.user.roles?.includes('SUPER_ADMIN') && record.createdById !== auth.user.id) {
    return NextResponse.json({ code: 40300, message: '无权限删除其他人的记录' }, { status: 403 });
  }

  await prisma.dataRecord.delete({ where: { id } });

  return NextResponse.json({ ok: true, deletedId: id });
}
