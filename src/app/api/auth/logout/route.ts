import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { currentSessionId: null }
    });
  }

  // 与登录保持一致：HTTPS 下的 Secure cookie 需要同样带 Secure 才能被浏览器删除
  const isHttps = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 0
  });
  return response;
}
