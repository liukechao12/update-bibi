import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import { getEventCategoryOptions } from '@/lib/event-categories';
import EventRecordsTableClient from './event-records-client';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

type SearchParams = {
  page?: string;
  pageSize?: string;
  category?: string;
  keyword?: string;
  source?: string;
  tendency?: string;
  startDate?: string;
  endDate?: string;
};

function parsePageSize(value?: string) {
  if (!value || value === 'all') return 'all' as const;
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number]) ? parsed : DEFAULT_PAGE_SIZE;
}

export default async function EventRecordsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const resolvedSearchParams = await searchParams;

  const eventCategoryOptions = await getEventCategoryOptions();
  const pageSize = parsePageSize(resolvedSearchParams.pageSize);
  const page = Math.max(1, Number(resolvedSearchParams.page ?? '1') || 1);
  const category = resolvedSearchParams.category?.trim() ?? '';
  const keyword = resolvedSearchParams.keyword?.trim() ?? '';
  const source = resolvedSearchParams.source?.trim() ?? '';
  const tendency = resolvedSearchParams.tendency?.trim() ?? '';

  const where: Prisma.EventRecordWhereInput = {};
  if (category && eventCategoryOptions.some((c) => c.value === category)) {
    where.category = category;
  }
  if (keyword) {
    where.OR = [
      { title: { contains: keyword } },
      { author: { contains: keyword } },
      { source: { contains: keyword } },
      { link: { contains: keyword } },
      { summary: { contains: keyword } }
    ];
  }
  if (source) {
    where.source = { contains: source };
  }
  if (tendency) {
    where.tendency = tendency;
  }
  if (resolvedSearchParams.startDate || resolvedSearchParams.endDate) {
    where.publishTime = {};
    if (resolvedSearchParams.startDate) where.publishTime.gte = new Date(resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) where.publishTime.lte = new Date(`${resolvedSearchParams.endDate}T23:59:59`);
  }

  let records: Array<{
    id: string;
    category: string;
    sourceFileName: string;
    seqNo: number;
    source: string | null;
    author: string | null;
    fansCount: number;
    authType: string | null;
    publishTime: Date | null;
    title: string | null;
    link: string | null;
    summary: string | null;
    viewCount: number | null;
    forwardCount: number | null;
    replyCount: number | null;
    praiseCount: number | null;
    tendency: string | null;
    rowNo: number;
    createdAt: Date;
  }> = [];
  let total = 0;
  let categoryCounts: Array<{ category: string; _count: { _all: number } }> = [];
  let dbError: string | null = null;

  // 关键优化：列表页不查 rawData（每行都是一整行原始 JSON，400k 数据下 20 行也会让 payload 膨胀几 MB），
  // 详情在展开行时按需通过 /api/event-records/[id] 懒加载；同时把「列表+总数」和「分类统计」分开查，
  // 任意一组超时或失败都不让整个页面 500。
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} 查询超时（>${ms}ms），可能是数据量大导致，请重试或缩小筛选条件`)), ms))
    ]);
  }

  try {
    const [r, c] = await Promise.all([
      withTimeout(
        prisma.eventRecord.findMany({
          where,
          orderBy: { publishTime: 'desc' },
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
            rowNo: true,
            createdAt: true
          },
          take: pageSize === 'all' ? 200 : pageSize,
          skip: pageSize === 'all' ? 0 : (page - 1) * (pageSize as number)
        }),
        15000,
        '列表'
      ),
      withTimeout(prisma.eventRecord.count({ where }), 15000, '总数')
    ]);
    records = r;
    total = c;
  } catch (error) {
    dbError = error instanceof Error ? error.message : String(error);
    console.error('[event-records] 列表/总数查询失败:', dbError);
  }

  // 分类统计单独查，失败不影响列表渲染
  try {
    categoryCounts = await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.eventRecord as any).groupBy({
        by: ['category'],
        _count: { _all: true }
      }) as Promise<typeof categoryCounts>,
      10000,
      '分类统计'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[event-records] 分类统计查询失败:', message);
    if (!dbError) dbError = `分类统计失败：${message}（列表数据仍可查看）`;
  }

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / (pageSize as number)));

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (keyword) params.set('keyword', keyword);
    if (source) params.set('source', source);
    if (tendency) params.set('tendency', tendency);
    if (resolvedSearchParams.startDate) params.set('startDate', resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) params.set('endDate', resolvedSearchParams.endDate);
    if (pageSize === 'all') {
      params.set('pageSize', 'all');
    } else {
      params.set('pageSize', String(pageSize));
    }
    params.set('page', String(targetPage));
    return `/event-records?${params.toString()}`;
  };

  const buildCurrentPageHref = () => buildPageHref(page);

  const serializableRecords = records.map((record) => ({
    id: record.id,
    category: record.category,
    sourceFileName: record.sourceFileName,
    seqNo: record.seqNo,
    source: record.source ?? '',
    author: record.author ?? '',
    fansCount: record.fansCount,
    authType: record.authType ?? '',
    publishTime: record.publishTime ? formatBeijingTime(record.publishTime) : '',
    title: record.title ?? '',
    link: record.link ?? '',
    summary: record.summary ?? '',
    viewCount: record.viewCount,
    forwardCount: record.forwardCount,
    replyCount: record.replyCount,
    praiseCount: record.praiseCount,
    tendency: record.tendency ?? '',
    rowNo: record.rowNo,
    createdAt: formatBeijingTime(record.createdAt)
  }));

  const countMap: Record<string, number> = {};
  categoryCounts.forEach((item) => {
    countMap[item.category] = item._count._all;
  });
  const totalCount = categoryCounts.reduce((sum, item) => sum + item._count._all, 0);

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">事件数据查询</span>
          <h1>事件 Excel 数据查询</h1>
          <p>查询从事件 Excel 文件导入的数据，按分类区分来源文件。</p>
        </div>
        <div className="stack">
          <a className="button secondary" href="/">返回首页</a>
        </div>
      </div>

      {dbError ? (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
          <p style={{ margin: 0, fontWeight: 700 }}>提示：{dbError}</p>
          <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6 }}>
            若看到超时，可尝试：1) 选择一个分类后查询；2) 避免空关键词的全表扫描；3) 检查数据库连接。
            若表尚未创建，请在本地执行：<code>npx prisma migrate deploy</code> → <code>npx prisma generate</code> → 重启 <code>npm run dev</code>。
          </p>
        </div>
      ) : null}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="grid grid-4">
          {eventCategoryOptions.map((item) => (
            <div className="kpi" key={item.value} style={{ background: '#f8fafc', borderRadius: 12, padding: 14 }}>
              <div className="label">{item.label}</div>
              <div className="value" style={{ fontSize: 22 }}>{countMap[item.value] ?? 0}</div>
            </div>
          ))}
        </div>
        <p className="helper" style={{ margin: '8px 0 0' }}>全部分类共 {totalCount} 条</p>
      </div>

      <form className="card" style={{ padding: 16, marginBottom: 16 }} method="GET">
        <div className="grid grid-4">
          <select className="select" name="category" defaultValue={category}>
            <option value="">全部分类</option>
            {eventCategoryOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <input className="input" name="keyword" placeholder="标题 / 作者 / 来源 / 链接 / 摘要" defaultValue={keyword} />
          <input className="input" name="source" placeholder="来源（如：新浪微博）" defaultValue={source} />
          <select className="select" name="tendency" defaultValue={tendency}>
            <option value="">全部倾向性</option>
            <option value="负面">负面</option>
            <option value="中性">中性</option>
            <option value="正面">正面</option>
          </select>
        </div>
        <div className="grid grid-4" style={{ marginTop: 12 }}>
          <input className="input" type="date" name="startDate" defaultValue={resolvedSearchParams.startDate ?? ''} />
          <input className="input" type="date" name="endDate" defaultValue={resolvedSearchParams.endDate ?? ''} />
          <select className="select" name="pageSize" defaultValue={resolvedSearchParams.pageSize ?? String(DEFAULT_PAGE_SIZE)}>
            <option value="20">每页 20 条</option>
            <option value="50">每页 50 条</option>
            <option value="100">每页 100 条</option>
            <option value="200">每页 200 条</option>
          </select>
          <div className="stack">
            <button className="button" type="submit">查询</button>
            <a className="button secondary" href="/event-records">重置</a>
          </div>
        </div>
      </form>

      <div className="card" style={{ padding: 20 }}>
        <EventRecordsTableClient records={serializableRecords} />

        <div className="stack" style={{ marginTop: 16, justifyContent: 'space-between' }}>
          <span className="helper">共 {total} 条 · 第 {page} / {totalPages} 页</span>
          <div className="stack">
            {pageSize === 'all' ? (
              <a className="button secondary" href={buildCurrentPageHref()} aria-disabled style={{ pointerEvents: 'none', opacity: 0.5 }}>上一页</a>
            ) : (
              <Link className="button secondary" href={buildPageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} style={page <= 1 ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>上一页</Link>
            )}
            {pageSize === 'all' ? (
              <a className="button secondary" href={buildCurrentPageHref()} aria-disabled style={{ pointerEvents: 'none', opacity: 0.5 }}>下一页</a>
            ) : (
              <Link className="button secondary" href={buildPageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} style={page >= totalPages ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>下一页</Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
