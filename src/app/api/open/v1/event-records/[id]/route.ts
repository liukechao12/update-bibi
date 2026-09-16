import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { eventCategoryList } from '@/lib/labels';
import { buildApiResponse, logExternalApiRequest, requireExternalApiClient } from '@/lib/external-api';
import { formatBeijingTime } from '@/lib/time';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const auth = await requireExternalApiClient(request);
  if ('error' in auth) return auth.error;

  const client = auth.client;
  const { id } = await params;
  const record = await prisma.eventRecord.findUnique({
    where: { id },
    select: {
      id: true,
      category: true,
      seqNo: true,
      source: true,
      author: true,
      fansCount: true,
      authType: true,
      publishTime: true,
      title: true,
      link: true,
      summary: true,
      viewCount: true,
      forwardCount: true,
      replyCount: true,
      praiseCount: true,
      tendency: true,
      rowNo: true,
    }
  });

  if (!record) {
    return NextResponse.json({ code: 40400, message: '记录不存在' }, { status: 404 });
  }

  if (!client.allowAllEvents) {
    const allowed = (await prisma.externalApiClientEventScope.findMany({ where: { clientId: client.id }, select: { eventCategory: true } })).map((item) => item.eventCategory);
    if (!allowed.includes(record.category)) {
      return NextResponse.json({ code: 40302, message: '无权查看该记录' }, { status: 403 });
    }
  }

  await logExternalApiRequest({
    clientId: client.id,
    path: '/api/open/v1/event-records/[id]',
    method: 'GET',
    requestIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')?.trim() ?? null,
    requestQuery: { id },
    responseCode: 200,
    responseCount: 1,
    costMs: Date.now() - startedAt
  });

  return buildApiResponse({
    id: record.id,
    category: record.category,
    seqNo: record.seqNo,
    source: record.source,
    author: record.author,
    fansCount: record.fansCount,
    authType: record.authType,
    publishTime: record.publishTime ? formatBeijingTime(record.publishTime) : '',
    title: record.title,
    link: record.link,
    summary: record.summary,
    viewCount: record.viewCount,
    forwardCount: record.forwardCount,
    replyCount: record.replyCount,
    praiseCount: record.praiseCount,
    tendency: record.tendency,
    rowNo: record.rowNo,
  });
}
