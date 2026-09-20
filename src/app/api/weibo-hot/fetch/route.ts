import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { isWeiboHotFetchRunning, runWeiboHotFetch } from '@/lib/weibo-hot';

// 异步触发：整轮抓取可能要几分钟，接口立即返回，由前端轮询 latest 感知结果
export async function POST() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  if (isWeiboHotFetchRunning()) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  void runWeiboHotFetch({ force: true }).catch((error) => {
    console.error('[weibo-hot] 手动抓取失败:', error instanceof Error ? error.message : error);
  });

  return NextResponse.json({ ok: true, started: true });
}
