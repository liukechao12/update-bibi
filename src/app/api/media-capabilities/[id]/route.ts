import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const current = await prisma.mediaMetricCapability.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ code: 40400, message: '记录不存在' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const sourceName = typeof body.sourceName === 'string' ? body.sourceName.trim() : undefined;
  if (sourceName !== undefined && sourceName.length === 0) {
    return NextResponse.json({ code: 40002, message: '媒体名称不能为空' }, { status: 400 });
  }
  if (sourceName !== undefined && sourceName !== current.sourceName) {
    const duplicated = await prisma.mediaMetricCapability.findUnique({ where: { sourceName } });
    if (duplicated) return NextResponse.json({ code: 40003, message: `媒体「${sourceName}」已存在` }, { status: 409 });
  }

  const updated = await prisma.mediaMetricCapability.update({
    where: { id },
    data: {
      ...(sourceName !== undefined ? { sourceName } : {}),
      ...(typeof body.category === 'string' ? { category: body.category.trim() || null } : {}),
      ...(body.commentCollectable !== undefined ? { commentCollectable: toBoolean(body.commentCollectable, current.commentCollectable) } : {}),
      ...(body.forwardCollectable !== undefined ? { forwardCollectable: toBoolean(body.forwardCollectable, current.forwardCollectable) } : {}),
      ...(body.praiseCollectable !== undefined ? { praiseCollectable: toBoolean(body.praiseCollectable, current.praiseCollectable) } : {}),
      ...(typeof body.remark === 'string' ? { remark: body.remark.trim() || null } : {})
    }
  });

  return NextResponse.json({ ok: true, capability: updated });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;
  const { id } = await params;

  await prisma.mediaMetricCapability.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
