import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import { batchStatusLabelMap, importTypeLabelMap, labelOrValue, pushJobStatusLabelMap, recordStatusLabelMap } from '@/lib/labels';

function resolveFailureReason(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== 'object') return '-';
  const value = responseBody as { error?: unknown };
  return typeof value.error === 'string' && value.error.trim() ? value.error : '-';
}

function isTimeoutReason(reason: string) {
  return reason.includes('超时') || reason.toLowerCase().includes('timeout');
}

export default async function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const currentUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { roles: { include: { role: true } } }
  });

  const batch = await prisma.dataBatch.findUnique({
    where: { id },
    include: {
      createdBy: true,
      records: {
        orderBy: { createdAt: 'asc' },
        include: {
          pushItems: true
        }
      },
      pushJobs: {
        include: { items: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!batch) {
    notFound();
  }

  const isAdmin = Boolean(currentUser?.roles?.some((item) => item.role.roleCode === 'SUPER_ADMIN'));
  if (!isAdmin && batch.createdById !== user.id) {
    notFound();
  }

  const failedItems = batch.pushJobs.flatMap((job) =>
    job.items
      .filter((item) => item.status !== 'SUCCESS')
      .map((item) => ({
        jobNo: job.jobNo,
        recordId: item.recordId,
        status: item.status,
        errorMessage: item.errorMessage ?? '-',
        vendorResponseCode: item.vendorResponseCode ?? '-'
      }))
  );

  const recordStatusTone = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return { bg: '#eaf7ef', color: '#0f9d58' };
      case 'FAILED':
        return { bg: '#fdeaea', color: '#d14343' };
      case 'RETRYING':
      case 'PUSHING':
      case 'PENDING_PUSH':
        return { bg: '#fff4e6', color: '#b45309' };
      case 'DUPLICATE':
        return { bg: '#eef2ff', color: '#4f6ef7' };
      default:
        return { bg: '#f1f4f9', color: '#6b7a90' };
    }
  };

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">批次详情</span>
          <h1>{batch.batchNo}</h1>
          <p>导入方式：{labelOrValue(importTypeLabelMap, batch.importType)} · 提交人：{batch.createdBy.displayName} · 状态：{labelOrValue(batchStatusLabelMap, batch.status)}</p>
        </div>
        <a className="button secondary" href="/batches">返回批次列表</a>
      </div>

      <section className="grid grid-4" style={{ marginTop: 0 }}>
        <div className="card kpi"><div className="label">总条数</div><div className="value">{batch.totalCount}</div></div>
        <div className="card kpi"><div className="label">有效条数</div><div className="value">{batch.validCount}</div></div>
        <div className="card kpi"><div className="label">成功数</div><div className="value">{batch.successCount}</div></div>
        <div className="card kpi"><div className="label">失败数</div><div className="value">{batch.failCount}</div></div>
      </section>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">批次概览</h2>
          <table className="table">
            <tbody>
              <tr><th>总条数</th><td>{batch.totalCount}</td></tr>
              <tr><th>有效条数</th><td>{batch.validCount}</td></tr>
              <tr><th>无效条数</th><td>{batch.invalidCount}</td></tr>
              <tr><th>创建时间</th><td>{formatBeijingTime(batch.createdAt)}</td></tr>
              <tr><th>推送时间</th><td>{formatBeijingTime(batch.pushedAt)}</td></tr>
              <tr><th>备注</th><td>{batch.remark ?? '-'}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">推送任务</h2>
          {batch.pushJobs.length === 0 ? (
            <p className="helper">暂无推送任务</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>任务号</th>
                    <th>状态</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>HTTP</th>
                    <th>失败原因</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.pushJobs.map((job) => {
                    const reason = resolveFailureReason(job.responseBody);
                    const timeout = isTimeoutReason(reason);
                    return (
                      <tr key={job.id} style={timeout ? { background: '#fff5f5' } : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>{job.jobNo}</td>
                        <td>
                          <span style={{
                            background: timeout ? '#fdeaea' : job.status === 'FAILED' ? '#fbeaec' : '#f1f4f9',
                            color: timeout ? '#b42318' : job.status === 'FAILED' ? '#c0262d' : '#6b7a90',
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
                        <td>{job.insertedCount}</td>
                        <td>{job.failedCount}</td>
                        <td>{job.httpStatus ?? '-'}</td>
                        <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: timeout ? '#b42318' : 'inherit' }} title={reason === '-' ? undefined : reason}>{reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {batch.pushJobs.some((job) => job.requestBody) ? (
        <div className="card" style={{ padding: 20, marginTop: 20 }}>
          <h2 className="section-title">推送内容</h2>
          <div className="stack" style={{ gap: 12 }}>
            {batch.pushJobs.map((job) => (
              <details key={job.id} style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                  {job.jobNo} · {job.batchId ? '批次推送' : '推送任务'}
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', margin: '12px 0 0' }}>
                  {JSON.stringify(job.requestBody, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </div>
      ) : null}

      {failedItems.length > 0 ? (
        <div className="card" style={{ padding: 20, marginTop: 20 }}>
          <h2 className="section-title">失败明细</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>任务号</th>
                  <th>记录ID</th>
                  <th>状态</th>
                  <th>供应商响应码</th>
                  <th>失败原因</th>
                </tr>
              </thead>
              <tbody>
                {failedItems.map((item, index) => (
                  <tr key={index} style={item.errorMessage.includes('超时') ? { background: '#fff5f5' } : undefined}>
                    <td>{item.jobNo}</td>
                    <td>{item.recordId}</td>
                    <td>{item.status}</td>
                    <td>{item.vendorResponseCode}</td>
                    <td style={{ color: item.errorMessage.includes('超时') ? '#b42318' : 'inherit' }}>{item.errorMessage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 20, marginTop: 20 }}>
        <h2 className="section-title">记录明细</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>textId</th>
                <th>标题</th>
                <th>作者</th>
                <th>来源</th>
                <th>状态</th>
                <th>推送结果</th>
              </tr>
            </thead>
            <tbody>
              {batch.records.map((record) => {
                const items = record.pushItems;
                const hasFailed = items.some((item) => item.status !== 'SUCCESS');
                const allSuccess = items.length > 0 && items.every((item) => item.status === 'SUCCESS');
                const tone = recordStatusTone(record.recordStatus);
                const pushTone = allSuccess
                  ? { bg: '#eaf7ef', color: '#0f9d58' }
                  : hasFailed
                    ? { bg: '#fdeaea', color: '#d14343' }
                    : { bg: '#f1f4f9', color: '#6b7a90' };
                const pushLabel = allSuccess ? '成功' : hasFailed ? '失败' : '未推送';

                return (
                  <tr key={record.id}>
                    <td>
                      <Link href={`/records/${record.id}`}>{record.textId}</Link>
                    </td>
                    <td>{record.title.slice(0, 40)}{record.title.length > 40 ? '...' : ''}</td>
                    <td>{record.author}</td>
                    <td>{record.originType}</td>
                    <td>
                      <span style={{ background: tone.bg, color: tone.color, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                        {labelOrValue(recordStatusLabelMap, record.recordStatus)}
                      </span>
                    </td>
                    <td>
                      <span style={{ background: pushTone.bg, color: pushTone.color, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                        {pushLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {batch.pushJobs.some((job) => job.responseBody) ? (
        <div className="card" style={{ padding: 20, marginTop: 20 }}>
          <h2 className="section-title">推送响应</h2>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {JSON.stringify(batch.pushJobs.map((job) => ({ jobNo: job.jobNo, responseBody: job.responseBody })), null, 2)}
          </pre>
        </div>
      ) : null}
    </main>
  );
}
