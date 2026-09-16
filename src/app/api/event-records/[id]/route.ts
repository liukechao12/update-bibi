import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { formatBeijingTime } from '@/lib/time';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const record = await prisma.eventRecord.findUnique({
    where: { id },
    select: {
      id: true,
      category: true,
      sourceFileName: true,
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
      rawData: true,
      rowNo: true,
      createdAt: true
    }
  });

  if (!record) {
    return NextResponse.json({ code: 40400, message: '记录不存在' }, { status: 404 });
  }

  return NextResponse.json({
    id: record.id,
    category: record.category,
    sourceFileName: record.sourceFileName,
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
    rawData: record.rawData,
    rowNo: record.rowNo,
    createdAt: formatBeijingTime(record.createdAt)
  });
}
