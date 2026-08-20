import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/api-auth';

export async function PATCH(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const user = await prisma.user.update({
    where: { id },
    data: { status: 'DISABLED' }
  });

  return NextResponse.json({ ok: true, user });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const user = await prisma.user.update({
    where: { id },
    data: { status: 'ACTIVE' }
  });

  return NextResponse.json({ ok: true, user });
}
