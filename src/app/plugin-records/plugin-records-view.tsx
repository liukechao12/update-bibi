import { labelOrValue, originTypeLabelMap, pushJobStatusLabelMap, recordStatusLabelMap } from '@/lib/labels';

export type PluginRecordsViewProps = {
  filters: { keyword: string; clientId: string; status: string; startDate: string; endDate: string };
  clients: Array<{ id: string; clientName: string; clientCode: string }>;
  records: Array<{
    id: string; textId: string; title: string; text: string; url: string; author: string;
    sourceName: string | null; originType: string; publishTime: string; recordStatus: string; receivedAt: string;
    client: { clientName: string; clientCode: string; department: string | null } | null;
    lastPush: {
      status: string; errorMessage: string | null; vendorResponseCode: string | null;
      pushType: string; jobNo: string; httpStatus: number | null; createdAt: string;
    } | null;
  }>;
  total: number;
  page: number;
  totalPages: number;
  errors: string[];
};

export default function PluginRecordsView({ filters, clients, records, total, page, totalPages, errors }: PluginRecordsViewProps) {
  const href = (targetPage: number) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    params.set('page', String(targetPage));
    return `/plugin-records?${params.toString()}`;
  };
  return (
    <main className="container" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <div className="header">
        <div className="brand">
          <span className="badge">插件数据</span>
          <h1 style={{ textWrap: 'balance' }}>插件数据与推送状态</h1>
          <p style={{ textWrap: 'pretty' }}>查看插件已入库的记录，以及记录当前的推送状态。</p>
        </div>
        <a className="button secondary" href={href(page)}>刷新状态</a>
      </div>

      <p className="helper" style={{ lineHeight: 1.7 }}>
        仅展示启用来源追踪后，经插件新增、更新或重复提交确认的记录；历史记录未做来源推断。
        同一记录只显示一次，插件与接收时间取最近一次，状态为当前记录状态，不代表每次提交的独立回执。
      </p>

      <form className="card" style={{ padding: 16, marginBottom: 16 }} method="GET" action="/plugin-records">
        <div className="grid grid-3">
          <label>搜索记录<input className="input" name="keyword" placeholder="标题 / textId / 作者 / 链接" defaultValue={filters.keyword} /></label>
          <label>最近提交插件<select className="select" name="clientId" defaultValue={filters.clientId}>
            <option value="">全部插件</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.clientName}（{client.clientCode}）</option>)}
          </select></label>
          <label>当前推送状态<select className="select" name="status" defaultValue={filters.status}>
            <option value="">全部状态</option>
            {Object.entries(recordStatusLabelMap).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select></label>
        </div>
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <label>接收开始日期（北京时间）<input className="input" type="date" name="startDate" defaultValue={filters.startDate} /></label>
          <label>接收结束日期（北京时间）<input className="input" type="date" name="endDate" defaultValue={filters.endDate} /></label>
        </div>
        {errors.length > 0 ? <p role="alert" style={{ color: 'var(--danger)' }}>{errors.join(' ')}</p> : null}
        <div className="stack" style={{ marginTop: 12 }}>
          <button className="button" type="submit">筛选</button>
          <a className="button secondary" href="/plugin-records">重置</a>
        </div>
      </form>

      <div className="card" style={{ padding: 20 }}>
        <h2 className="section-title">数据明细 <span className="helper">共 {total} 条</span></h2>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 1050 }}>
            <thead><tr>
              <th scope="col">内容</th><th scope="col">最近提交插件</th><th scope="col">最近接收时间</th>
              <th scope="col">当前推送状态</th><th scope="col">最近一次推送</th>
            </tr></thead>
            <tbody>
              {records.length === 0 ? <tr><td colSpan={5}>
                <p>{errors.length ? '请修正筛选条件后重试。' : '暂无符合条件的插件记录。'}</p>
                <a href="/external-api-logs?path=%2Fapi%2Fplugin%2Frecords">查看插件接口日志</a>
              </td></tr> : records.map((record) => (
                <tr key={record.id}>
                  <td style={{ minWidth: 280, maxWidth: 420, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                    <strong>{record.title}</strong>
                    <p className="helper">{record.textId}</p>
                    <p className="helper">{labelOrValue(originTypeLabelMap, record.originType)} · {record.sourceName || '来源未填写'} · {record.author}</p>
                    <p className="helper">发布时间：{record.publishTime}</p>
                    <details>
                      <summary>查看正文</summary>
                      <p style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{record.text}</p>
                      {/^https?:\/\//i.test(record.url) ? <a href={record.url} target="_blank" rel="noopener noreferrer">打开原文</a> : <span>原文链接无效</span>}
                    </details>
                  </td>
                  <td style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                    {record.client?.clientName ?? '插件已删除'}
                    <p className="helper">{record.client?.clientCode ?? '来源标记保留'}</p>
                    {record.client?.department ? <p className="helper">{record.client.department}</p> : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{record.receivedAt}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <strong style={{ color: record.recordStatus === 'SUCCESS' ? 'var(--success)' : record.recordStatus === 'FAILED' ? 'var(--danger)' : 'var(--text)' }}>
                      {record.recordStatus === 'SUCCESS' ? '推送成功' : record.recordStatus === 'FAILED' ? '推送失败' : labelOrValue(recordStatusLabelMap, record.recordStatus)}
                    </strong>
                    <p><a href={`/records?status=ALL&keyword=${encodeURIComponent(record.textId)}`}>查看数据记录</a></p>
                  </td>
                  <td style={{ minWidth: 240, maxWidth: 360, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                    {record.lastPush ? <>
                      <span>{record.lastPush.pushType === 'UPDATE' ? '更新' : '新增'} · {labelOrValue(pushJobStatusLabelMap, record.lastPush.status)}</span>
                      <p className="helper">{record.lastPush.createdAt}</p>
                      {record.lastPush.status === 'FAILED' ? <p style={{ color: 'var(--danger)' }}>{record.lastPush.errorMessage || '暂无详细失败原因'}</p> : null}
                      <details>
                        <summary>查看推送详情</summary>
                        <p>任务号：{record.lastPush.jobNo}</p>
                        <p>HTTP 状态码：{record.lastPush.httpStatus ?? '暂无回执'}</p>
                        <p>客户错误码：{record.lastPush.vendorResponseCode ?? '—'}</p>
                      </details>
                    </> : <span className="helper">暂无推送明细</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="helper">成功以系统保存的客户回执为依据；失败或超时不等于客户一定未收到。最近一次推送可能早于本次接收，不能代替当前状态。</p>
        <div className="stack" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <span className="helper">每页 20 条 · 第 {page} / {totalPages} 页</span>
          <div className="stack">
            {page > 1 ? <a className="button secondary" href={href(page - 1)}>上一页</a> : <button className="button secondary" disabled>上一页</button>}
            {page < totalPages ? <a className="button secondary" href={href(page + 1)}>下一页</a> : <button className="button secondary" disabled>下一页</button>}
          </div>
        </div>
      </div>
    </main>
  );
}
