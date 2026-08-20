import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/guards';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const password = String(body?.password ?? '');
  if (!password) {
    return NextResponse.json({ code: 40002, message: '新密码不能为空' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash }
  });

  return NextResponse.json({ ok: true, userId: user.id });
}
