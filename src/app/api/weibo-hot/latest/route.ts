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

  // 为播报文案补充：首次上榜时间 + 相对上一批次的排名趋势
  const words = [...new Set(topics.map((topic) => topic.word))];
  const prevBatch = await prisma.weiboHotTopic.findFirst({
    where: { batchAt: { lt: latest.batchAt } },
    orderBy: { batchAt: 'desc' },
    select: { batchAt: true }
  });
  const [firstSeenRows, prevRows] = await Promise.all([
    words.length > 0
      ? prisma.weiboHotTopic.groupBy({
          by: ['word', 'channel'],
          where: { word: { in: words } },
          _min: { batchAt: true }
        })
      : Promise.resolve([]),
    prevBatch
      ? prisma.weiboHotTopic.findMany({
          where: { batchAt: prevBatch.batchAt },
          select: { word: true, channel: true, rank: true }
        })
      : Promise.resolve([])
  ]);
  const firstSeenMap = new Map(firstSeenRows.map((row) => [`${row.channel}||${row.word}`, row._min.batchAt]));
  const prevRankMap = new Map(prevRows.map((row) => [`${row.channel}||${row.word}`, row.rank]));

  const enrichedTopics = topics.map((topic) => {
    const key = `${topic.channel}||${topic.word}`;
    const prevRank = prevRankMap.get(key);
    const rankTrend = prevRank === undefined ? 'new' : topic.rank < prevRank ? 'up' : topic.rank > prevRank ? 'down' : 'same';
    return { ...topic, firstSeenAt: firstSeenMap.get(key) ?? topic.batchAt, rankTrend };
  });

  return NextResponse.json({
    batchAt: latest.batchAt,
    topics: enrichedTopics,
    matchedCount,
    total,
    channels,
    keywords: WEIBO_HOT_KEYWORDS,
    contentChecked: Boolean(process.env.WEIBO_COOKIE?.trim())
  });
}
