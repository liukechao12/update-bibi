import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { signAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');

  if (!username || !password) {
    return NextResponse.json({ code: 40002, message: '用户名和密码不能为空' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { username },
    include: { roles: { include: { role: true } } }
  });

  if (!user) {
    return NextResponse.json({ code: 40101, message: '用户名或密码错误' }, { status: 401 });
  }

  if (user.status === 'DISABLED') {
    return NextResponse.json({ code: 40301, message: '该账号已被禁用' }, { status: 403 });
  }

  const verified = await bcrypt.compare(password, user.passwordHash);
  if (!verified) {
    return NextResponse.json({ code: 40101, message: '用户名或密码错误' }, { status: 401 });
  }

  const sessionId = crypto.randomUUID();
  const roles = user.roles.map((item) => item.role.roleCode);
  const token = signAuthToken({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles,
    sessionId
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), currentSessionId: sessionId }
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      roles
    }
  });
  // 仅 HTTPS 访问才加 Secure；服务器用 HTTP+IP 部署时加了会导致浏览器拒存 cookie、登录后跳回登录页
  const isHttps = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
  response.cookies.set('sync_push_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  });

  return response;
}
