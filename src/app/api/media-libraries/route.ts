import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

const baseInclude = {
  createdBy: true
} as const;

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('keyword')?.trim() ?? '';
  const originType = searchParams.get('originType')?.trim() ?? '';
  const publisherType = searchParams.get('publisherType')?.trim() ?? '';
  const status = searchParams.get('status')?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSizeParam = searchParams.get('pageSize')?.trim() ?? '';

  const pageSize = pageSizeParam === 'all' ? 'all' : (PAGE_SIZE_OPTIONS.includes(Number(pageSizeParam) as (typeof PAGE_SIZE_OPTIONS)[number]) ? Number(pageSizeParam) : DEFAULT_PAGE_SIZE);

  const where: Prisma.MediaLibraryWhereInput = {};
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { domain: { contains: keyword } },
      { authorName: { contains: keyword } },
      { remark: { contains: keyword } }
    ];
  }
  if (originType && ['media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other'].includes(originType)) {
    where.originType = originType as never;
  }
  if (publisherType && ['MEDIA', 'SOCIAL'].includes(publisherType)) {
    where.publisherType = publisherType as never;
  }
  if (status && ['ACTIVE', 'DISABLED'].includes(status)) {
    where.status = status as never;
  }

  const [mediaLibraries, total] = await Promise.all([
    prisma.mediaLibrary.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: baseInclude,
      take: pageSize === 'all' ? undefined : pageSize,
      skip: pageSize === 'all' ? undefined : (page - 1) * pageSize
    }),
    prisma.mediaLibrary.count({ where })
  ]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));

  return NextResponse.json({ mediaLibraries, total, page, pageSize, totalPages });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  const domain = String(body?.domain ?? '').trim();
  const authorName = String(body?.authorName ?? '').trim();
  const originType = String(body?.originType ?? '').trim();
  const publisherType = String(body?.publisherType ?? '').trim();
  const authorType = String(body?.authorType ?? '').trim();
  const priority = Number(body?.priority ?? 0);
  const status = String(body?.status ?? 'ACTIVE').trim();
  const remark = String(body?.remark ?? '').trim();
  const createdById = auth.user.id;

  if (!name || !originType || !publisherType) {
    return NextResponse.json({ code: 40002, message: '名称、来源类型、发布类型不能为空' }, { status: 400 });
  }

  if (originType && !['media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other'].includes(originType)) {
    return NextResponse.json({ code: 40003, message: '来源类型不合法' }, { status: 400 });
  }

  if (publisherType && !['MEDIA', 'SOCIAL'].includes(publisherType)) {
    return NextResponse.json({ code: 40003, message: '发布类型不合法' }, { status: 400 });
  }

  if (authorType && !['BLUE_V', 'SELF_MEDIA', 'PERSONAL'].includes(authorType)) {
    return NextResponse.json({ code: 40003, message: '作者类型不合法' }, { status: 400 });
  }

  if (status && !['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ code: 40003, message: '状态不合法' }, { status: 400 });
  }

  const created = await prisma.mediaLibrary.create({
    data: {
      name,
      domain: domain || null,
      authorName: authorName || null,
      originType: originType as never,
      publisherType: publisherType as never,
      authorType: authorType ? (authorType as never) : null,
      priority: Number.isNaN(priority) ? 0 : priority,
      status: status as never,
      remark: remark || null,
      createdById
    },
    include: baseInclude
  });

  return NextResponse.json({ ok: true, mediaLibrary: created });
}
