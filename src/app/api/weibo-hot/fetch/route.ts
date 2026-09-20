import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { runWeiboHotFetch } from '@/lib/weibo-hot';

export async function POST() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const result = await runWeiboHotFetch({ force: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ code: 50201, message: `抓取微博热点失败：${message}` }, { status: 502 });
  }
}
