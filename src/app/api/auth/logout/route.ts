import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { currentSessionId: null }
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 0
  });
  return response;
}
