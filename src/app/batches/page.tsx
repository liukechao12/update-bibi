import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import { batchStatusLabelMap, importTypeLabelMap, labelOrValue } from '@/lib/labels';

const PAGE_SIZE = 20;

export default async function BatchesPage({ searchParams }: { searchParams: Promise<{ page?: string; keyword?: string; status?: string; importType?: string }> }) {
  const user = await requireUser();
  const resolvedSearchParams = await searchParams;

  const page = Math.max(1, Number(resolvedSearchParams.page ?? '1') || 1);
  const keyword = resolvedSearchParams.keyword?.trim() ?? '';

  const where: Prisma.DataBatchWhereInput = {};
  if (!user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = user.id;
  }
  if (keyword) {
    where.OR = [
      { batchNo: { contains: keyword } },
      { sourceFileName: { contains: keyword } },
      { remark: { contains: keyword } }
    ];
  }
  if (resolvedSearchParams.status) {
    where.status = resolvedSearchParams.status as unknown as Prisma.EnumBatchStatusFilter;
  }
  if (resolvedSearchParams.importType) {
    where.importType = resolvedSearchParams.importType as unknown as Prisma.EnumImportTypeFilter;
  }

  const [batches, total] = await Promise.all([
    prisma.dataBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: {
        createdBy: true,
        _count: {
          select: { records: true, pushJobs: true }
        }
      }
    }),
    prisma.dataBatch.count({ where })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status);
    if (resolvedSearchParams.importType) params.set('importType', resolvedSearchParams.importType);
    params.set('page', String(targetPage));
    return `/batches?${params.toString()}`;
  };

  const buildExportHref = () => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status);
    if (resolvedSearchParams.importType) params.set('importType', resolvedSearchParams.importType);
    return `/api/batches/export?${params.toString()}`;
  };

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">批次管理</span>
          <h1>导入批次与推送批次</h1>
          <p>这里直接从数据库读取最近批次，用于核对导入与推送结果。</p>
        </div>
        <div className="stack">
          <a className="button secondary" href={buildExportHref()}>导出 CSV</a>
          <a className="button secondary" href="/">返回首页</a>
        </div>
      </div>

      <form className="card" style={{ padding: 16, marginBottom: 16 }} method="GET">
        <div className="grid grid-4">
          <input className="input" name="keyword" placeholder="批次号/文件名/备注" defaultValue={keyword} />
          <select className="select" name="status" defaultValue={resolvedSearchParams.status ?? ''}>
            <option value="">全部状态</option>
            <option value="CREATED">已创建</option>
            <option value="VALIDATING">校验中</option>
            <option value="PENDING_PUSH">待推送</option>
            <option value="PUSHING">推送中</option>
            <option value="PARTIAL_SUCCESS">部分成功</option>
            <option value="SUCCESS">成功</option>
            <option value="FAILED">失败</option>
            <option value="CLOSED">已关闭</option>
          </select>
          <select className="select" name="importType" defaultValue={resolvedSearchParams.importType ?? ''}>
            <option value="">全部导入方式</option>
            <option value="PASTE">粘贴录入</option>
            <option value="EXCEL">Excel 导入</option>
            <option value="MANUAL">手工录入</option>
            <option value="API">接口导入</option>
          </select>
          <button className="button" type="submit">筛选</button>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          <a className="button secondary" href="/batches">重置</a>
        </div>
      </form>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 1100, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 170 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 170 }} />
            </colgroup>
            <thead>
              <tr>
                <th>批次号</th>
                <th>创建人</th>
                <th>导入方式</th>
                <th>总条数</th>
                <th>有效条数</th>
                <th>状态</th>
                <th>记录数</th>
                <th>推送任务数</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center' }}>暂无数据</td></tr>
              ) : batches.map((batch) => (
                <tr key={batch.id}>
                  <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Link href={`/batches/${batch.id}`}>{batch.batchNo}</Link>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{batch.createdBy.displayName}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{labelOrValue(importTypeLabelMap, batch.importType)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{batch.totalCount}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{batch.validCount}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{labelOrValue(batchStatusLabelMap, batch.status)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{batch._count.records}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{batch._count.pushJobs}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatBeijingTime(batch.createdAt)}</td>
                </tr>
              ))}
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
