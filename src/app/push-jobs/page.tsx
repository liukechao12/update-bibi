import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { pushJobStatusLabelMap, labelOrValue } from '@/lib/labels';
import { formatBeijingTime } from '@/lib/time';
import RetryButton from './retry-button';

const PAGE_SIZE = 20;

function resolveFailureReason(responseBody: Prisma.JsonValue | null) {
  if (!responseBody) return '-';
  if (typeof responseBody === 'object' && responseBody !== null) {
    const error = (responseBody as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return '-';
}

function isTimeoutReason(reason: string) {
  return reason.includes('超时') || reason.toLowerCase().includes('timeout');
}

export default async function PushJobsPage({ searchParams }: { searchParams: Promise<{ status?: string; userId?: string; startDate?: string; endDate?: string; page?: string }> }) {
  const user = await requireUser();
  const resolvedSearchParams = await searchParams;

  const page = Math.max(1, Number(resolvedSearchParams.page ?? '1') || 1);

  const where: Prisma.PushJobWhereInput = {};
  if (resolvedSearchParams.status) {
    where.status = resolvedSearchParams.status as unknown as Prisma.EnumPushJobStatusFilter;
  }
  const isAdmin = Boolean(user.roles?.includes('SUPER_ADMIN'));
  if (resolvedSearchParams.userId && isAdmin) {
    where.createdById = resolvedSearchParams.userId;
  } else if (!isAdmin) {
    where.createdById = user.id;
  }
  if (resolvedSearchParams.startDate || resolvedSearchParams.endDate) {
    where.createdAt = {};
    if (resolvedSearchParams.startDate) where.createdAt.gte = new Date(resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) where.createdAt.lte = new Date(`${resolvedSearchParams.endDate}T23:59:59`);
  }

  const [jobs, users, total] = await Promise.all([
    prisma.pushJob.findMany({
      where,
      include: { batch: true, createdBy: true },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE
    }),
    prisma.user.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } }),
    prisma.pushJob.count({ where })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status);
    if (resolvedSearchParams.userId) params.set('userId', resolvedSearchParams.userId);
    if (resolvedSearchParams.startDate) params.set('startDate', resolvedSearchParams.startDate);
    if (resolvedSearchParams.endDate) params.set('endDate', resolvedSearchParams.endDate);
    params.set('page', String(targetPage));
    return `/push-jobs?${params.toString()}`;
  };

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">推送日志</span>
          <h1>批次推送任务</h1>
          <p>查看每次推送的请求体、响应体、状态和重试结果，支持按状态、用户、时间筛选。</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <form className="card" style={{ padding: 16, marginBottom: 16 }} method="GET">
        <div className="grid grid-4">
          <select className="select" name="status" defaultValue={resolvedSearchParams.status ?? ''}>
            <option value="">全部状态</option>
            <option value="SUCCESS">成功</option>
            <option value="FAILED">失败</option>
            <option value="RETRYING">重试中</option>
            <option value="SENDING">发送中</option>
            <option value="PENDING">待发送</option>
          </select>
          <select className="select" name="userId" defaultValue={resolvedSearchParams.userId ?? ''}>
            <option value="">全部用户</option>
            {users.map((userItem) => (
              <option key={userItem.id} value={userItem.id}>{userItem.displayName}</option>
            ))}
          </select>
          <input className="input" type="date" name="startDate" defaultValue={resolvedSearchParams.startDate ?? ''} />
          <input className="input" type="date" name="endDate" defaultValue={resolvedSearchParams.endDate ?? ''} />
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          <button className="button" type="submit">筛选</button>
          <a className="button secondary" href="/push-jobs">重置</a>
        </div>
      </form>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 1280, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 120 }} />
            </colgroup>
            <thead>
              <tr>
                <th>任务号</th>
                <th>批次号</th>
                <th>推送类型</th>
                <th>提交人</th>
                <th>状态</th>
                <th>成功</th>
                <th>失败</th>
                <th>环境</th>
                <th>失败原因</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center' }}>暂无数据</td></tr>
              ) : jobs.map((job) => {
                const reason = resolveFailureReason(job.responseBody);
                const timeout = isTimeoutReason(reason);
                const statusTone = timeout
                  ? { bg: '#fdeaea', color: '#b42318' }
                  : job.status === 'FAILED'
                    ? { bg: '#fbeaec', color: '#c0262d' }
                    : { bg: '#f1f4f9', color: '#6b7a90' };

                return (
                  <tr key={job.id} style={timeout ? { background: '#fff5f5' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.jobNo}</td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.batch ? <Link href={`/batches/${job.batch.id}`}>{job.batch.batchNo}</Link> : '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{job.pushType === 'UPDATE' ? '更新' : '新增'}</td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.createdBy?.displayName ?? '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{
                        background: statusTone.bg,
                        color: statusTone.color,
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        minHeight: 28
                      }}>
                        {labelOrValue(pushJobStatusLabelMap, job.status)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{job.insertedCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{job.failedCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{job.env}</td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: timeout ? '#b42318' : 'inherit' }} title={reason === '-' ? undefined : reason}>{reason}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatBeijingTime(job.createdAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {job.status === 'FAILED' ? <RetryButton jobId={job.id} /> : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
