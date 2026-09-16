import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { eventCategoryExists } from '@/lib/event-categories';
import { buildApiResponse, allowedCategories, logExternalApiRequest, normalizeExternalPageSize, requireExternalApiClient } from '@/lib/external-api';
import { formatBeijingTime } from '@/lib/time';

type CursorPayload = {
  publishTime: string;
  id: string;
};

function encodeCursor(payload: CursorPayload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded) as CursorPayload;
    if (!parsed.publishTime || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireExternalApiClient(request);
  if ('error' in auth) return auth.error;

  const client = auth.client;
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() ?? '';
  const keyword = searchParams.get('keyword')?.trim() ?? '';
  const source = searchParams.get('source')?.trim() ?? '';
  const tendency = searchParams.get('tendency')?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSize = normalizeExternalPageSize(searchParams.get('pageSize'));
  const startTime = searchParams.get('startTime')?.trim() ?? '';
  const endTime = searchParams.get('endTime')?.trim() ?? '';
  const updatedSince = searchParams.get('updatedSince')?.trim() ?? '';
  const cursor = searchParams.get('cursor')?.trim() ?? '';

  // 指定 category 时无需加载全部分类；仅在自动选择唯一授权分类时查询授权列表。
  const categories = category
    ? []
    : await allowedCategories({
        allowAllEvents: client.allowAllEvents,
        eventScopes: await prisma.externalApiClientEventScope.findMany({
          where: { clientId: client.id },
          select: { eventCategory: true }
        })
      });

  if (!client.allowAllEvents && category) {
    const hasAccess = await prisma.externalApiClientEventScope.findFirst({
      where: { clientId: client.id, eventCategory: category },
      select: { id: true }
    });
    if (!hasAccess) {
      return NextResponse.json({ code: 40302, message: '无权查询该事件项目' }, { status: 403 });
    }
  } else if (!client.allowAllEvents && !category && categories.length > 0) {
    // categories 仅用于未指定 category 时自动选择唯一授权事件。
  }

  const selectedCategory = category || (categories.length === 1 ? categories[0] : '');
  if (!selectedCategory) {
    return NextResponse.json({ code: 40002, message: '请指定 category' }, { status: 400 });
  }
  if (!(await eventCategoryExists(selectedCategory))) {
    return NextResponse.json({ code: 40003, message: '事件项目不存在' }, { status: 400 });
  }

  const where: Prisma.EventRecordWhereInput = { category: selectedCategory };
  if (keyword) {
    where.OR = [
      { title: { contains: keyword } },
      { author: { contains: keyword } },
      { source: { contains: keyword } },
      { link: { contains: keyword } },
      { summary: { contains: keyword } }
    ];
  }
  if (source) where.source = { contains: source };
  if (tendency) where.tendency = tendency;
  if (startTime || endTime) {
    where.publishTime = {};
    if (startTime) where.publishTime.gte = new Date(startTime);
    if (endTime) where.publishTime.lte = new Date(`${endTime}T23:59:59`);
  }
  if (updatedSince) {
    where.createdAt = { gte: new Date(updatedSince) };
  }

  const cursorPayload = cursor ? decodeCursor(cursor) : null;
  if (cursor && !cursorPayload) {
    return NextResponse.json({ code: 40003, message: 'cursor 不合法' }, { status: 400 });
  }

  if (cursorPayload) {
    const cursorCondition: Prisma.EventRecordWhereInput = {
      OR: [
        { publishTime: { lt: new Date(cursorPayload.publishTime) } },
        {
          AND: [
            { publishTime: new Date(cursorPayload.publishTime) },
            { id: { lt: cursorPayload.id } }
          ]
        }
      ]
    };
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      cursorCondition
    ];
    delete where.OR;
  }

  const isCursorMode = Boolean(cursor || updatedSince);

  const records = await prisma.eventRecord.findMany({
    where,
    orderBy: [{ publishTime: 'desc' }, { id: 'desc' }],
    skip: isCursorMode ? 0 : (page - 1) * pageSize,
    take: pageSize,
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

  const includeTotal = searchParams.get('includeTotal') === 'true';
  const total = includeTotal && !isCursorMode ? await prisma.eventRecord.count({ where }) : undefined;
  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;

  const data = records.map((record) => ({
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
  }));

  const nextCursor = records.length === pageSize && records[records.length - 1]?.publishTime
    ? encodeCursor({
        publishTime: records[records.length - 1].publishTime!.toISOString(),
        id: records[records.length - 1].id
      })
    : null;

  void logExternalApiRequest({
    clientId: client.id,
    path: '/api/open/v1/event-records',
    method: 'GET',
    requestIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')?.trim() ?? null,
    requestQuery: Object.fromEntries(searchParams.entries()),
    responseCode: 200,
    responseCount: data.length,
    costMs: Date.now() - startedAt
  });

  return buildApiResponse(data, {
    category: selectedCategory,
    allowAllEvents: client.allowAllEvents,
    pagination: isCursorMode || total === undefined ? { page, pageSize } : { page, pageSize, total, totalPages },
    sync: {
      mode: isCursorMode ? 'cursor' : 'page',
      updatedSince: updatedSince || null,
      nextCursor
    }
  });
}
