import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('keyword')?.trim() ?? '';
  const category = searchParams.get('category')?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSizeParam = searchParams.get('pageSize')?.trim() ?? '';
  const pageSize = pageSizeParam === 'all'
    ? 'all'
    : (PAGE_SIZE_OPTIONS.includes(Number(pageSizeParam) as (typeof PAGE_SIZE_OPTIONS)[number]) ? Number(pageSizeParam) : DEFAULT_PAGE_SIZE);

  const where: Prisma.MediaMetricCapabilityWhereInput = {};
  if (keyword) {
    where.OR = [
      { sourceName: { contains: keyword } },
      { remark: { contains: keyword } }
    ];
  }
  if (category) where.category = category;

  const [capabilities, total] = await Promise.all([
    prisma.mediaMetricCapability.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sourceName: 'asc' }],
      take: pageSize === 'all' ? undefined : pageSize,
      skip: pageSize === 'all' ? undefined : (page - 1) * pageSize
    }),
    prisma.mediaMetricCapability.count({ where })
  ]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  return NextResponse.json({ capabilities, total, page, pageSize, totalPages });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const sourceName = String(body?.sourceName ?? '').trim();
  if (!sourceName) {
    return NextResponse.json({ code: 40002, message: '媒体名称不能为空' }, { status: 400 });
  }

  const existing = await prisma.mediaMetricCapability.findUnique({ where: { sourceName } });
  if (existing) {
    return NextResponse.json({ code: 40003, message: `媒体「${sourceName}」已存在，请直接修改` }, { status: 409 });
  }

  const created = await prisma.mediaMetricCapability.create({
    data: {
      sourceName,
      category: String(body?.category ?? '').trim() || null,
      commentCollectable: toBoolean(body?.commentCollectable, false),
      forwardCollectable: toBoolean(body?.forwardCollectable, false),
      praiseCollectable: toBoolean(body?.praiseCollectable, false),
      remark: String(body?.remark ?? '').trim() || null
    }
  });

  return NextResponse.json({ ok: true, capability: created });
}
