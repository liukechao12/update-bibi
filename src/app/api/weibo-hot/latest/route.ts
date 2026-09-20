import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { WEIBO_HOT_CHANNELS, WEIBO_HOT_KEYWORDS } from '@/lib/weibo-hot';

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const matchedOnly = url.searchParams.get('matchedOnly') === '1';
  const channel = url.searchParams.get('channel')?.trim() || '';

  const latest = await prisma.weiboHotTopic.findFirst({
    orderBy: { batchAt: 'desc' },
    select: { batchAt: true }
  });

  const channels = WEIBO_HOT_CHANNELS.map((item) => item.name);

  if (!latest) {
    return NextResponse.json({
      batchAt: null,
      topics: [],
      matchedCount: 0,
      total: 0,
      channels,
      keywords: WEIBO_HOT_KEYWORDS,
      contentChecked: Boolean(process.env.WEIBO_COOKIE?.trim())
    });
  }

  const baseWhere = {
    batchAt: latest.batchAt,
    ...(channel ? { channel } : {})
  };

  const [topics, matchedCount, total] = await Promise.all([
    prisma.weiboHotTopic.findMany({
      where: { ...baseWhere, ...(matchedOnly ? { matched: true } : {}) },
      orderBy: [{ channel: 'asc' }, { rank: 'asc' }]
    }),
    prisma.weiboHotTopic.count({ where: { ...baseWhere, matched: true } }),
    prisma.weiboHotTopic.count({ where: baseWhere })
  ]);

  return NextResponse.json({
    batchAt: latest.batchAt,
    topics,
    matchedCount,
    total,
    channels,
    keywords: WEIBO_HOT_KEYWORDS,
    contentChecked: Boolean(process.env.WEIBO_COOKIE?.trim())
  });
}
