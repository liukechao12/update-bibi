import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ code: 40100, message: '未登录' }, { status: 401 }) };
  }
  return { user };
}

export async function requireApiAdmin() {
  const result = await requireApiUser();
  if ('error' in result) return result;
  if (!result.user.roles?.includes('SUPER_ADMIN')) {
    return { error: NextResponse.json({ code: 40301, message: '无权限' }, { status: 403 }) };
  }
  return result;
}
