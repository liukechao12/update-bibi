import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';

const PAGE_SIZE = 20;

type SearchParams = {
  clientId?: string;
  path?: string;
  startDate?: string;
  endDate?: string;
  page?: string;
};

export default async function ExternalApiLogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, Number(resolvedSearchParams.page ?? '1') || 1);

  const where: Prisma.ExternalApiRequestLogWhereInput = {};
  if (resolvedSearchParams.clientId) where.clientId = resolvedSearchParams.clientId;
  if (resolvedSearchParams.path) where.path = { contains: resolvedSearchParams.path };
  if (resolvedSearchParams.startDate || resolvedSearchParams.endDate) {
    where.createdAt = {};
    if (resolvedSearchParams.startDate) where.createdAt.gte = new Date(resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) where.createdAt.lte = new Date(`${resolvedSearchParams.endDate}T23:59:59`);
  }

  const [logs, clients, total] = await Promise.all([
    prisma.externalApiRequestLog.findMany({
      where,
      include: { client: true },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE
    }),
    prisma.externalApiClient.findMany({ orderBy: { clientCode: 'asc' }, select: { id: true, clientCode: true, clientName: true } }),
    prisma.externalApiRequestLog.count({ where })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (resolvedSearchParams.clientId) params.set('clientId', resolvedSearchParams.clientId);
    if (resolvedSearchParams.path) params.set('path', resolvedSearchParams.path);
    if (resolvedSearchParams.startDate) params.set('startDate', resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) params.set('endDate', resolvedSearchParams.endDate);
    params.set('page', String(targetPage));
    return `/external-api-logs?${params.toString()}`;
  };

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">开放 API 日志</span>
          <h1>外部客户调用日志</h1>
          <p>查看客户调用接口、状态码、耗时、返回条数与来源 IP。</p>
        </div>
        <div className="stack">
          <a className="button secondary" href="/external-api-clients">返回客户管理</a>
          <a className="button secondary" href="/">返回首页</a>
        </div>
      </div>

      <form className="card" style={{ padding: 16, marginBottom: 16 }} method="GET">
        <div className="grid grid-4">
          <select className="select" name="clientId" defaultValue={resolvedSearchParams.clientId ?? ''}>
            <option value="">全部客户</option>
            {clients.map((item) => (
              <option key={item.id} value={item.id}>{item.clientCode} / {item.clientName}</option>
            ))}
          </select>
          <input className="input" name="path" placeholder="接口路径关键字" defaultValue={resolvedSearchParams.path ?? ''} />
          <input className="input" type="date" name="startDate" defaultValue={resolvedSearchParams.startDate ?? ''} />
          <input className="input" type="date" name="endDate" defaultValue={resolvedSearchParams.endDate ?? ''} />
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          <button className="button" type="submit">筛选</button>
          <a className="button secondary" href="/external-api-logs">重置</a>
        </div>
      </form>

      <div className="card" style={{ padding: 20 }}>
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>客户</th>
              <th>方法</th>
              <th>路径</th>
              <th>IP</th>
              <th>状态码</th>
              <th>返回条数</th>
              <th>耗时</th>
              <th>请求参数</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center' }}>暂无日志</td></tr>
            ) : logs.map((item) => (
              <tr key={item.id}>
                <td>{formatBeijingTime(item.createdAt)}</td>
                <td>{item.client.clientCode} / {item.client.clientName}</td>
                <td>{item.method}</td>
                <td>{item.path}</td>
                <td>{item.requestIp || '-'}</td>
                <td>{item.responseCode}</td>
                <td>{item.responseCount}</td>
                <td>{item.costMs}ms</td>
                <td>
                  <details>
                    <summary>查看</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{JSON.stringify(item.requestQuery, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="stack" style={{ marginTop: 16, justifyContent: 'space-between' }}>
          <span className="helper">共 {total} 条 · 第 {page} / {totalPages} 页</span>
          <div className="stack">
            <Link className="button secondary" href={buildPageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} style={page <= 1 ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>上一页</Link>
            <Link className="button secondary" href={buildPageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} style={page >= totalPages ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>下一页</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
