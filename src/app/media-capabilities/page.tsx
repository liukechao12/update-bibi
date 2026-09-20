import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import MediaCapabilityClient from './media-capability-client';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

function parsePageSize(value?: string) {
  if (!value || value === 'all') return 'all' as const;
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number]) ? parsed : DEFAULT_PAGE_SIZE;
}

export default async function MediaCapabilitiesPage({ searchParams }: { searchParams: Promise<{ page?: string; pageSize?: string; keyword?: string; category?: string }> }) {
  await requireUser();

  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, Number(resolvedSearchParams.page ?? '1') || 1);
  const pageSize = parsePageSize(resolvedSearchParams.pageSize);
  const keyword = resolvedSearchParams.keyword?.trim() ?? '';
  const category = resolvedSearchParams.category?.trim() ?? '';

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

  const serialized = capabilities.map((item) => ({
    id: item.id,
    sourceName: item.sourceName,
    category: item.category ?? '',
    commentCollectable: item.commentCollectable,
    forwardCollectable: item.forwardCollectable,
    praiseCollectable: item.praiseCollectable,
    remark: item.remark ?? '',
    updatedAt: formatBeijingTime(item.updatedAt)
  }));

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">媒体采集能力</span>
          <h1>评论 / 转发 / 点赞采集能力维护</h1>
          <p>按媒体名称维护三项互动指标是否可采集。推送时：可采集推具体数值，不可采集推 null；不在表内的媒体默认推 null，仅非 0 读数保留具体值。</p>
        </div>
        <a className="button secondary" href="/media-libraries">媒体库管理</a>
      </div>

      <MediaCapabilityClient
        capabilities={serialized}
        searchParams={{ keyword, category, page: page as unknown as string, pageSize: pageSize as unknown as string }}
        total={total}
        totalPages={totalPages}
      />
    </main>
  );
}
