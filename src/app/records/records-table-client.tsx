'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { labelOrValue, originTypeLabelMap, recordStatusLabelMap } from '@/lib/labels';

type RecordItem = {
  id: string;
  textId: string;
  title: string;
  author: string;
  originType: string;
  url: string;
  publishTime: string;
  commentNum: number;
  forwardNum: number | null;
  praiseNum: number | null;
  viewNum: number | null;
  tendency: string | null;
  recordStatus: string;
  submitterName?: string | null;
  isDuplicate: boolean;
  batchId: string | null;
  sourceDepartment: string | null;
  batchNo: string | null;
  createdByName: string | null;
  createdAt: string;
};

type RowDetail = { text: string | null; rawSourceText: string | null };

function statusTone(status: string) {
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
}

function resolveRaw(rawSourceText: string | null) {
  if (!rawSourceText) return null;
  try {
    return JSON.stringify(JSON.parse(rawSourceText), null, 2);
  } catch {
    return rawSourceText;
  }
}

export default function RecordsTableClient({ records }: { records: RecordItem[] }) {
  const router = useRouter();
  const [openRows, setOpenRows] = useState<string[]>([]);
  const [rowDetails, setRowDetails] = useState<Record<string, RowDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pushing, setPushing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const [batchMessage, setBatchMessage] = useState('');
  const [batchMessageTone, setBatchMessageTone] = useState<'success' | 'error' | ''>('');

  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.includes(record.id) && (record.recordStatus === 'PENDING_PUSH' || record.recordStatus === 'VALIDATED' || record.recordStatus === 'FAILED')),
    [records, selectedIds]
  );

  const pushingRecords = useMemo(
    () => records.filter((record) => record.recordStatus === 'PUSHING'),
    [records]
  );

  const allSelectableIds = useMemo(
    () => records.filter((record) => record.recordStatus === 'PENDING_PUSH' || record.recordStatus === 'VALIDATED' || record.recordStatus === 'FAILED').map((record) => record.id),
    [records]
  );

  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedIds.includes(id));

  async function loadDetail(id: string) {
    if (rowDetails[id] || detailLoading[id]) return;
    setDetailLoading((current) => ({ ...current, [id]: true }));
    try {
      const response = await fetch(`/api/records/${id}`);
      const payload = await response.json();
      if (response.ok && payload.record) {
        setRowDetails((current) => ({
          ...current,
          [id]: { text: payload.record.text ?? null, rawSourceText: payload.record.rawSourceText ?? null }
        }));
      } else {
        setRowDetails((current) => ({ ...current, [id]: { text: null, rawSourceText: null } }));
      }
    } catch {
      setRowDetails((current) => ({ ...current, [id]: { text: null, rawSourceText: null } }));
    } finally {
      setDetailLoading((current) => ({ ...current, [id]: false }));
    }
  }

  function toggleRow(id: string) {
    const willOpen = !openRows.includes(id);
    setOpenRows((current) =>
      willOpen ? [...current, id] : current.filter((item) => item !== id)
    );
    if (willOpen) loadDetail(id);
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : allSelectableIds);
  }

  function buildSummary(payload: { batchNo?: string; results?: Array<{ inserted?: number; failed?: number }> }) {
    const results = payload.results ?? [];
    const inserted = results.reduce((sum, item) => sum + (item.inserted ?? 0), 0);
    const failed = results.reduce((sum, item) => sum + (item.failed ?? 0), 0);
    return `${payload.batchNo ? `批次 ${payload.batchNo} ` : ''}推送完成，成功 ${inserted} 条，失败 ${failed} 条`;
  }

  async function handleBatchPush() {
    if (selectedRecords.length === 0) return;
    setPushing(true);
    setBatchMessage('');
    try {
      const response = await fetch('/api/push/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: selectedRecords.map((record) => record.id) })
      });
      const payload = await response.json();
      if (!response.ok) {
        setBatchMessage(payload.message ?? '批量推送失败');
        setBatchMessageTone('error');
        return;
      }
      setBatchMessage(buildSummary(payload));
      setBatchMessageTone('success');
      setSelectedIds([]);
      router.refresh();
    } finally {
      setPushing(false);
    }
  }

  async function handleSinglePush(id: string) {
    setRowMessages((current) => ({ ...current, [id]: '' }));
    try {
      const response = await fetch('/api/push/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: [id] })
      });
      const payload = await response.json();
      if (!response.ok) {
        setRowMessages((current) => ({ ...current, [id]: payload.message ?? '推送失败' }));
        return;
      }
      setRowMessages((current) => ({ ...current, [id]: buildSummary(payload) }));
      router.refresh();
    } catch (error) {
      setRowMessages((current) => ({ ...current, [id]: error instanceof Error ? error.message : '推送失败' }));
    }
  }

  async function handleResetStuck() {
    if (pushingRecords.length === 0) return;
    if (!window.confirm(`确认将 ${pushingRecords.length} 条"推送中"的记录重置为失败？\n重置后可重新推送。`)) return;
    setResetting(true);
    setBatchMessage('');
    try {
      const response = await fetch('/api/records/reset-stuck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: pushingRecords.map((record) => record.id) })
      });
      const payload = await response.json();
      if (!response.ok) {
        setBatchMessage(payload.message ?? '重置失败');
        setBatchMessageTone('error');
        return;
      }
      setBatchMessage(`已重置 ${payload.resetCount ?? 0} 条推送中记录为失败`);
      setBatchMessageTone('success');
      router.refresh();
    } catch (error) {
      setBatchMessage(error instanceof Error ? error.message : '重置失败');
      setBatchMessageTone('error');
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('确认删除这条待推送记录？删除后不可恢复。')) return;
    setDeleting(id);
    setBatchMessage('');
    try {
      const response = await fetch(`/api/records/${id}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) {
        setBatchMessage(payload.message ?? '删除失败');
        setBatchMessageTone('error');
        return;
      }
      setBatchMessage('已删除该记录');
      setBatchMessageTone('success');
      router.refresh();
    } catch (error) {
      setBatchMessage(error instanceof Error ? error.message : '删除失败');
      setBatchMessageTone('error');
    } finally {
      setDeleting(null);
    }
  }

  async function handleBatchDelete() {
    const deletable = selectedRecords.filter((record) => record.recordStatus === 'PENDING_PUSH');
    if (deletable.length === 0) return;
    if (!window.confirm(`确认删除 ${deletable.length} 条待推送记录？删除后不可恢复。`)) return;
    setDeleting('batch');
    setBatchMessage('');
    try {
      const response = await fetch('/api/records/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: deletable.map((record) => record.id) })
      });
      const payload = await response.json();
      if (!response.ok) {
        setBatchMessage(payload.message ?? '批量删除失败');
        setBatchMessageTone('error');
        return;
      }
      setBatchMessage(`已删除 ${payload.deletedCount ?? 0} 条记录`);
      setBatchMessageTone('success');
      setSelectedIds([]);
      router.refresh();
    } catch (error) {
      setBatchMessage(error instanceof Error ? error.message : '批量删除失败');
      setBatchMessageTone('error');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      {batchMessage ? (
        <div style={{ marginBottom: 12, background: batchMessageTone === 'error' ? '#fdeaea' : '#eaf7ef', color: batchMessageTone === 'error' ? '#b42318' : '#0f9d58', border: `1px solid ${batchMessageTone === 'error' ? '#f5c2c7' : '#cde8d4'}`, padding: 12, borderRadius: 12 }}>
          {batchMessage}
        </div>
      ) : null}

      <div className="stack" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="stack">
          <label className="helper" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            全选待推送
          </label>
          <span className="helper">已选 {selectedRecords.length} 条</span>
        </div>
        <div className="stack">
          {pushingRecords.length > 0 ? (
            <button className="button secondary" type="button" onClick={handleResetStuck} disabled={resetting}>
              {resetting ? '重置中...' : `重置 ${pushingRecords.length} 条推送中`}
            </button>
          ) : null}
          <button className="button secondary" type="button" onClick={handleBatchDelete} disabled={selectedRecords.filter((record) => record.recordStatus === 'PENDING_PUSH').length === 0 || deleting === 'batch'}>
            {deleting === 'batch' ? '删除中...' : `删除待推送 (${selectedRecords.filter((record) => record.recordStatus === 'PENDING_PUSH').length})`}
          </button>
          <button className="button" type="button" onClick={handleBatchPush} disabled={selectedRecords.length === 0 || pushing}>
            {pushing ? '批量推送中...' : '批量推送'}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table" style={{ minWidth: 1540, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 300 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th></th>
              <th>textId</th>
              <th>标题</th>
              <th>作者</th>
              <th>来源</th>
              <th>来源部门</th>
              <th>互动数据</th>
              <th>状态</th>
              <th>批次</th>
              <th>提交人</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={13} style={{ textAlign: 'center' }}>暂无数据</td></tr>
            ) : records.map((record) => {
              const open = openRows.includes(record.id);
              const canPush = record.recordStatus === 'PENDING_PUSH' || record.recordStatus === 'VALIDATED' || record.recordStatus === 'FAILED';
              const canDelete = record.recordStatus === 'PENDING_PUSH';
              const tone = statusTone(record.recordStatus);
              const detail = rowDetails[record.id];
              const raw = resolveRaw(detail?.rawSourceText ?? null);
              const failed = record.recordStatus === 'FAILED';

              return (
                <Fragment key={record.id}>
                  <tr style={failed ? { background: '#fff5f5' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="link-button" onClick={() => toggleRow(record.id)}>
                        {open ? '▼' : '▶'}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(record.id)}
                        onChange={() => toggleSelect(record.id)}
                        disabled={!canPush}
                        title={record.recordStatus === 'FAILED' ? '失败记录可重新推送' : undefined}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Link href={`/records/${record.id}`}>{record.textId}</Link>
                    </td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.title}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.author}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOrValue(originTypeLabelMap, record.originType)}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.sourceDepartment || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      评论 {record.commentNum} · 转发 {record.forwardNum ?? 0} · 点赞 {record.praiseNum ?? 0} · 阅读 {record.viewNum ?? 0}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{
                        background: tone.bg,
                        color: tone.color,
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        minHeight: 28,
                        maxWidth: '100%'
                      }}>
                        {labelOrValue(recordStatusLabelMap, record.recordStatus)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {record.batchNo ? <Link href={`/batches/${record.batchId ?? ''}`}>{record.batchNo}</Link> : '-'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.createdByName ?? '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.createdAt}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div className="stack">
                        {canPush ? (
                          <button className="button secondary" type="button" onClick={() => handleSinglePush(record.id)} style={{ minWidth: 96 }}>
                            推送
                          </button>
                        ) : (
                          '-'
                        )}
                        {canDelete ? (
                          <button className="button secondary" type="button" onClick={() => handleDelete(record.id)} disabled={deleting === record.id} style={{ minWidth: 96 }}>
                            {deleting === record.id ? '删除中...' : '删除'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>

                  {open ? (
                    <tr>
                      <td colSpan={13} style={{ background: '#f8fafc', padding: 20 }}>
                        <div className="grid grid-2" style={{ gap: 20 }}>
                          <div>
                            <h3 style={{ margin: '0 0 8px' }}>解析保存内容</h3>
                            <table className="table">
                              <tbody>
                                <tr><th>textId</th><td>{record.textId}</td></tr>
                                <tr><th>标题</th><td>{record.title}</td></tr>
                                <tr><th>作者</th><td>{record.author}</td></tr>
                                <tr><th>来源</th><td>{labelOrValue(originTypeLabelMap, record.originType)}（{record.originType}）</td></tr>
                                <tr><th>来源部门</th><td>{record.sourceDepartment || '-'}</td></tr>
                                <tr><th>链接</th><td><a href={record.url} target="_blank" rel="noreferrer">{record.url}</a></td></tr>
                                <tr><th>发布时间</th><td>{record.publishTime}</td></tr>
                                <tr><th>评论数</th><td>{record.commentNum}</td></tr>
                                <tr><th>转发数</th><td>{record.forwardNum ?? '-'}</td></tr>
                                <tr><th>点赞数</th><td>{record.praiseNum ?? '-'}</td></tr>
                                <tr><th>阅读数</th><td>{record.viewNum ?? '-'}</td></tr>
                                <tr><th>倾向性</th><td>{record.tendency ?? '-'}</td></tr>
                                <tr><th>状态</th><td>{labelOrValue(recordStatusLabelMap, record.recordStatus)}</td></tr>
                                <tr><th>是否重复</th><td>{record.isDuplicate ? '是' : '否'}</td></tr>
                                <tr><th>提交人</th><td>{record.createdByName ?? '-'}</td></tr>
                                <tr><th>创建时间</th><td>{record.createdAt}</td></tr>
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <h3 style={{ margin: '0 0 8px' }}>正文内容</h3>
                            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, maxHeight: 360, overflow: 'auto' }}>
                              {detailLoading[record.id] ? '加载中...' : (detail?.text ?? '暂无内容')}
                            </div>
                            {raw ? (
                              <>
                                <h3 style={{ margin: '12px 0 8px' }}>原始字段</h3>
                                <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
                                  {raw}
                                </pre>
                              </>
                            ) : null}
                            {canPush ? (
                              <div className="stack" style={{ marginTop: 12 }}>
                                <button className="button" type="button" onClick={() => handleSinglePush(record.id)}>
                                  推送这条记录
                                </button>
                              </div>
                            ) : null}
                            {rowMessages[record.id] ? (
                              <div style={{ marginTop: 12, background: rowMessages[record.id].includes('失败') ? '#fdeaea' : '#eef2ff', color: rowMessages[record.id].includes('失败') ? '#b42318' : '#4f46e5', border: '1px solid #f5c2c7', padding: 12, borderRadius: 12 }}>
                                {rowMessages[record.id]}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
