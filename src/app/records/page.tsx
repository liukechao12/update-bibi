import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import RecordsTableClient from './records-table-client';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

type SearchParams = {
  page?: string;
  pageSize?: string;
  keyword?: string;
  status?: string;
  originType?: string;
  submitter?: string;
  startDate?: string;
  endDate?: string;
};

function parsePageSize(value?: string) {
  if (!value || value === 'all') return 'all' as const;
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number]) ? parsed : DEFAULT_PAGE_SIZE;
}

export default async function RecordsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const resolvedSearchParams = await searchParams;

  const pageSize = parsePageSize(resolvedSearchParams.pageSize);
  const page = Math.max(1, Number(resolvedSearchParams.page ?? '1') || 1);
  const keyword = resolvedSearchParams.keyword?.trim() ?? '';
  const submitter = resolvedSearchParams.submitter?.trim() ?? '';
  const statusFilter = !resolvedSearchParams.status || resolvedSearchParams.status === 'ALL' ? '' : resolvedSearchParams.status;

  const users = await prisma.user.findMany({
    select: { id: true, displayName: true },
    orderBy: { displayName: 'asc' }
  });

  const where: Prisma.DataRecordWhereInput = {};
  if (!user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = user.id;
  }
  if (submitter && user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = submitter;
  }
  if (keyword) {
    where.OR = [
      { textId: { contains: keyword } },
      { title: { contains: keyword } },
      { author: { contains: keyword } },
      { url: { contains: keyword } }
    ];
  }
  if (statusFilter) {
    where.recordStatus = statusFilter as unknown as Prisma.EnumRecordStatusFilter;
  }
  if (resolvedSearchParams.originType) {
    where.originType = resolvedSearchParams.originType as never;
  }
  if (resolvedSearchParams.startDate || resolvedSearchParams.endDate) {
    where.createdAt = {};
    if (resolvedSearchParams.startDate) where.createdAt.gte = new Date(resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) where.createdAt.lte = new Date(`${resolvedSearchParams.endDate}T23:59:59`);
  }

  const queryOptions = {
    where,
    orderBy: { createdAt: 'desc' as const },
    include: { batch: { include: { createdBy: true } } }
  };

  const [records, total] = await Promise.all([
    prisma.dataRecord.findMany({
      ...queryOptions,
      take: pageSize === 'all' ? undefined : pageSize,
      skip: pageSize === 'all' ? undefined : (page - 1) * pageSize
    }),
    prisma.dataRecord.count({ where })
  ]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status);
    if (resolvedSearchParams.originType) params.set('originType', resolvedSearchParams.originType);
    if (resolvedSearchParams.submitter) params.set('submitter', resolvedSearchParams.submitter);
    if (resolvedSearchParams.startDate) params.set('startDate', resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) params.set('endDate', resolvedSearchParams.endDate);
    if (pageSize === 'all') {
      params.set('pageSize', 'all');
    } else {
      params.set('pageSize', String(pageSize));
    }
    params.set('page', String(targetPage));
    return `/records?${params.toString()}`;
  };

  const buildExportHref = () => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (resolvedSearchParams.status && resolvedSearchParams.status !== 'ALL') params.set('status', resolvedSearchParams.status);
    if (resolvedSearchParams.originType) params.set('originType', resolvedSearchParams.originType);
    if (resolvedSearchParams.submitter) params.set('submitter', resolvedSearchParams.submitter);
    if (resolvedSearchParams.startDate) params.set('startDate', resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) params.set('endDate', resolvedSearchParams.endDate);
    return `/api/records/export?${params.toString()}`;
  };

  const buildCurrentPageHref = () => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status);
    if (resolvedSearchParams.originType) params.set('originType', resolvedSearchParams.originType);
    if (resolvedSearchParams.submitter) params.set('submitter', resolvedSearchParams.submitter);
    if (resolvedSearchParams.startDate) params.set('startDate', resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) params.set('endDate', resolvedSearchParams.endDate);
    if (pageSize === 'all') params.set('pageSize', 'all');
    else params.set('pageSize', String(pageSize));
    params.set('page', String(page));
    return `/records?${params.toString()}`;
  };

  const serializableRecords = records.map((record) => ({
    id: record.id,
    textId: record.textId,
    title: record.title,
    text: record.text,
    author: record.author,
    originType: record.originType,
    url: record.url,
    publishTime: formatBeijingTime(record.publishTime),
    commentNum: record.commentNum,
    forwardNum: record.forwardNum,
    praiseNum: record.praiseNum,
    viewNum: record.viewNum,
    tendency: record.tendency,
    recordStatus: record.recordStatus,
    isDuplicate: record.isDuplicate,
    rawSourceText: record.rawSourceText,
    batchId: record.batchId,
    batchNo: record.batch?.batchNo ?? null,
    createdByName: record.batch?.createdBy?.displayName ?? null,
    createdAt: formatBeijingTime(record.createdAt)
  }));

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">数据记录</span>
          <h1>数据明细与推送状态</h1>
          <p>这里用于查看每一条记录的标准化结果、推送状态和失败原因。</p>
        </div>
        <div className="stack">
          <a className="button secondary" href={buildExportHref()}>导出 CSV</a>
          <a className="button secondary" href="/">返回首页</a>
        </div>
      </div>

      <form className="card" style={{ padding: 16, marginBottom: 16 }} method="GET">
        <div className="grid grid-4">
          <input className="input" name="keyword" placeholder="textId/标题/作者/链接" defaultValue={keyword} />
          <select className="select" name="status" defaultValue={resolvedSearchParams.status ?? 'PENDING_PUSH'}>
            <option value="PENDING_PUSH">待推送（默认）</option>
            <option value="ALL">全部状态</option>
            <option value="DRAFT">草稿</option>
            <option value="VALIDATED">已校验</option>
            <option value="PUSHING">推送中</option>
            <option value="SUCCESS">成功</option>
            <option value="FAILED">失败</option>
            <option value="RETRYING">重试中</option>
            <option value="DUPLICATE">重复</option>
          </select>
          <select className="select" name="originType" defaultValue={resolvedSearchParams.originType ?? ''}>
            <option value="">全部来源</option>
            <option value="wb">微博</option>
            <option value="wx">微信</option>
            <option value="wz">网站</option>
            <option value="sp">视频</option>
            <option value="lt">论坛</option>
            <option value="app">App</option>
          </select>
          <select className="select" name="pageSize" defaultValue={resolvedSearchParams.pageSize ?? String(DEFAULT_PAGE_SIZE)}>
            <option value="20">每页 20 条</option>
            <option value="50">每页 50 条</option>
            <option value="100">每页 100 条</option>
            <option value="200">每页 200 条</option>
            <option value="all">全部查看</option>
          </select>
        </div>
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <select className="select" name="submitter" defaultValue={resolvedSearchParams.submitter ?? ''}>
            <option value="">全部提交人</option>
            {users.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
          <input className="input" type="date" name="startDate" defaultValue={resolvedSearchParams.startDate ?? ''} />
          <input className="input" type="date" name="endDate" defaultValue={resolvedSearchParams.endDate ?? ''} />
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          <button className="button" type="submit">筛选</button>
          <a className="button secondary" href="/records?status=PENDING_PUSH">重置</a>
        </div>
      </form>

      <div className="card" style={{ padding: 20 }}>
        <RecordsTableClient records={serializableRecords} />

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
