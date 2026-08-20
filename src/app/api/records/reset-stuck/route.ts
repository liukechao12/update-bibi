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

  const where = {
    id: { in: recordIds },
    recordStatus: 'PUSHING' as const,
    ...(auth.user.roles?.includes('SUPER_ADMIN') ? {} : { createdById: auth.user.id })
  };

  const result = await prisma.dataRecord.updateMany({
    where,
    data: { recordStatus: 'FAILED' }
  });

  return NextResponse.json({ ok: true, resetCount: result.count });
}
