import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import { mediaRuleStatusLabelMap, originTypeLabelMap, authorTypeLabelMap, publisherTypeLabelMap } from '@/lib/labels';
import MediaLibraryClient from './media-library-client';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

function parsePageSize(value?: string) {
  if (!value || value === 'all') return 'all' as const;
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number]) ? parsed : DEFAULT_PAGE_SIZE;
}

export default async function MediaLibrariesPage({ searchParams }: { searchParams: Promise<{ page?: string; pageSize?: string; keyword?: string; originType?: string; publisherType?: string; status?: string }> }) {
  await requireUser();

  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, Number(resolvedSearchParams.page ?? '1') || 1);
  const pageSize = parsePageSize(resolvedSearchParams.pageSize);
  const keyword = resolvedSearchParams.keyword?.trim() ?? '';
  const originType = resolvedSearchParams.originType?.trim() ?? '';
  const publisherType = resolvedSearchParams.publisherType?.trim() ?? '';
  const status = resolvedSearchParams.status?.trim() ?? '';

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

  const [mediaLibraries, total, users] = await Promise.all([
    prisma.mediaLibrary.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: { createdBy: true },
      take: pageSize === 'all' ? undefined : pageSize,
      skip: pageSize === 'all' ? undefined : (page - 1) * pageSize
    }),
    prisma.mediaLibrary.count({ where }),
    prisma.user.findMany({ orderBy: { displayName: 'asc' }, select: { id: true, displayName: true, username: true } })
  ]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const serializedMediaLibraries = mediaLibraries.map((item) => ({
    id: item.id,
    name: item.name,
    domain: item.domain ?? '',
    authorName: item.authorName ?? '',
    originType: item.originType,
    publisherType: item.publisherType,
    authorType: item.authorType ?? '',
    priority: item.priority,
    status: item.status,
    remark: item.remark ?? '',
    createdById: item.createdById,
    createdByName: item.createdBy?.displayName ?? item.createdBy?.username ?? '-',
    createdAt: formatBeijingTime(item.createdAt)
  }));

  const serializedUsers = users.map((user) => ({
    id: user.id,
    name: user.displayName,
    username: user.username
  }));

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">媒体库管理</span>
          <h1>媒体库规则维护</h1>
          <p>按域名和作者名称维护媒体库，并自动参与数据匹配。</p>
        </div>
        <a className="button secondary" href="/settings">返回系统配置</a>
      </div>

      <MediaLibraryClient
        mediaLibraries={serializedMediaLibraries}
        users={serializedUsers}
        labelMaps={{
          originTypeLabelMap,
          publisherTypeLabelMap,
          authorTypeLabelMap,
          mediaRuleStatusLabelMap
        }}
        searchParams={{ keyword, originType, publisherType, status, page: page as unknown as string, pageSize: pageSize as unknown as string }}
        total={total}
        totalPages={totalPages}
      />
    </main>
  );
}
