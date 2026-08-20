import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';

export async function POST(request: Request) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return NextResponse.json({ code: 40100, message: '未登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const oldPassword = String(body?.oldPassword ?? '');
  const newPassword = String(body?.newPassword ?? '');

  if (!oldPassword || !newPassword) {
    return NextResponse.json({ code: 40002, message: '原密码和新密码不能为空' }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ code: 40002, message: '新密码至少 8 位' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
  if (!user) {
    return NextResponse.json({ code: 40400, message: '用户不存在' }, { status: 404 });
  }

  const verified = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!verified) {
    return NextResponse.json({ code: 40101, message: '原密码错误' }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash }
  });

  return NextResponse.json({ ok: true });
}
