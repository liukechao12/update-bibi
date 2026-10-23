'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { labelOrValue, originTypeLabelMap, recordStatusLabelMap } from '@/lib/labels';
import { safeHref } from '@/lib/safe-url';

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
  screenshotCount: number;
};

type RowDetail = { text: string | null; rawSourceText: string | null; images: Array<{ id: string; localPath: string; vendorUrl: string | null; uploadStatus: string; mimeType: string; fileSize: number }> };

type ScreenshotPreview = { recordId: string; images: Array<{ id: string; localPath: string; uploadStatus: string }> };
type FullscreenImage = { src: string; alt: string };

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
  const [capturing, setCapturing] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<ScreenshotPreview | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<FullscreenImage | null>(null);
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
          [id]: {
            text: payload.record.text ?? null,
            rawSourceText: payload.record.rawSourceText ?? null,
            images: payload.record.images ?? []
          }
        }));
      } else {
        setRowDetails((current) => ({ ...current, [id]: { text: null, rawSourceText: null, images: [] } }));
      }
    } catch {
      setRowDetails((current) => ({ ...current, [id]: { text: null, rawSourceText: null, images: [] } }));
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

  async function handleScreenshot(id: string) {
    setCapturing(id);
    setRowMessages((current) => ({ ...current, [id]: '' }));
    try {
      const response = await fetch(`/api/records/${id}/screenshot`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        setRowMessages((current) => ({ ...current, [id]: payload.message ?? '截图失败' }));
        return;
      }
      setRowMessages((current) => ({ ...current, [id]: '截图已触发，请刷新页面查看' }));
      router.refresh();
    } catch (error) {
      setRowMessages((current) => ({ ...current, [id]: error instanceof Error ? error.message : '截图失败' }));
    } finally {
      setCapturing(null);
    }
  }

  async function handleViewScreenshots(id: string) {
    const response = await fetch(`/api/records/${id}`);
    const payload = await response.json();
    if (response.ok && payload.record?.images) {
      setScreenshotPreview({
        recordId: id,
        images: payload.record.images.map((img: any) => ({ id: img.id, localPath: img.localPath, uploadStatus: img.uploadStatus }))
      });
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
            <col style={{ width: 80 }} />
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
              <th>截图</th>
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
              <tr><td colSpan={14} style={{ textAlign: 'center' }}>暂无数据</td></tr>
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
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {record.screenshotCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleViewScreenshots(record.id)}
                          style={{ background: '#eaf7ef', color: '#0f9d58', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}
                          title="点击查看截图"
                        >
                          {record.screenshotCount} 张
                        </button>
                      ) : (
                        <span style={{ background: '#fdeaea', color: '#d14343', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                          无
                        </span>
                      )}
                    </td>
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
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => handleScreenshot(record.id)}
                          disabled={capturing === record.id}
                          title={capturing === record.id ? '截图中...' : '截图'}
                          style={{
                            padding: '6px 10px',
                            background: capturing === record.id ? '#f1f4f9' : '#fff',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            cursor: capturing === record.id ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            color: capturing === record.id ? '#999' : '#333'
                          }}
                        >
                          {capturing === record.id ? '' : '📷'}
                        </button>
                        {canPush ? (
                          <button
                            type="button"
                            onClick={() => handleSinglePush(record.id)}
                            title="推送"
                            style={{
                              padding: '6px 10px',
                              background: '#fff',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              cursor: 'pointer',
                              fontSize: 12,
                              color: '#333'
                            }}
                          >
                            📤
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(record.id)}
                            disabled={deleting === record.id}
                            title={deleting === record.id ? '删除中...' : '删除'}
                            style={{
                              padding: '6px 10px',
                              background: deleting === record.id ? '#f1f4f9' : '#fff',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              cursor: deleting === record.id ? 'not-allowed' : 'pointer',
                              fontSize: 12,
                              color: deleting === record.id ? '#999' : '#d14343'
                            }}
                          >
                            🗑
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>

                  {open ? (
                    <tr>
                      <td colSpan={14} style={{ background: '#f8fafc', padding: 20 }}>
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
                                <tr><th>链接</th><td><a href={safeHref(record.url)} target="_blank" rel="noreferrer">{record.url}</a></td></tr>
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
                            {detail?.images && detail.images.length > 0 ? (
                              <>
                                <h3 style={{ margin: '12px 0 8px' }}>截图 ({detail.images.length} 张)</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                  {detail.images.map((image) => (
                                    <div key={image.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                                      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                                        <span style={{
                                          background: image.uploadStatus === 'UPLOADED' ? '#eaf7ef' : image.uploadStatus === 'FAILED' ? '#fdeaea' : '#fff4e6',
                                          color: image.uploadStatus === 'UPLOADED' ? '#0f9d58' : image.uploadStatus === 'FAILED' ? '#d14343' : '#b45309',
                                          padding: '2px 8px',
                                          borderRadius: 999,
                                          fontSize: 11,
                                          fontWeight: 600
                                        }}>
                                          {image.uploadStatus === 'UPLOADED' ? '已上传' : image.uploadStatus === 'FAILED' ? '失败' : '待上传'}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
                                        {image.mimeType} · {(image.fileSize / 1024).toFixed(1)} KB
                                      </div>
                                      {image.vendorUrl ? (
                                        <div style={{ fontSize: 11, color: '#0f9d58', wordBreak: 'break-all' }}>
                                          客户 URL: {image.vendorUrl}
                                        </div>
                                      ) : null}
                                      <div style={{ fontSize: 11, color: '#999', wordBreak: 'break-all', marginTop: 4 }}>
                                        本地: {image.localPath}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div style={{ marginTop: 12 }}>
                                <div style={{ padding: 12, background: '#fdeaea', borderRadius: 12, fontSize: 13, color: '#d14343', marginBottom: 12 }}>
                                  暂无截图，该记录无法推送
                                </div>
                                <button className="button" type="button" onClick={() => handleScreenshot(record.id)} disabled={capturing === record.id}>
                                  {capturing === record.id ? '截图中...' : '立即截图'}
                                </button>
                              </div>
                            )}
                            <div className="stack" style={{ marginTop: 12 }}>
                              <button className="button secondary" type="button" onClick={() => handleScreenshot(record.id)} disabled={capturing === record.id}>
                                {capturing === record.id ? '截图中...' : '重新截图'}
                              </button>
                              {canPush ? (
                                <button className="button" type="button" onClick={() => handleSinglePush(record.id)}>
                                  推送这条记录
                                </button>
                              ) : null}
                            </div>
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

      {screenshotPreview ? (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20
          }}
          onClick={() => setScreenshotPreview(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 24,
              maxWidth: 1200,
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>截图预览</h3>
              <button
                type="button"
                onClick={() => setScreenshotPreview(null)}
                style={{
                  background: '#f1f4f9',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                关闭
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 20 }}>
              {screenshotPreview.images.map((image) => (
                <div key={image.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{
                      background: image.uploadStatus === 'UPLOADED' ? '#eaf7ef' : image.uploadStatus === 'FAILED' ? '#fdeaea' : '#fff4e6',
                      color: image.uploadStatus === 'UPLOADED' ? '#0f9d58' : image.uploadStatus === 'FAILED' ? '#d14343' : '#b45309',
                      padding: '4px 12px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600
                    }}>
                      {image.uploadStatus === 'UPLOADED' ? '已上传' : image.uploadStatus === 'FAILED' ? '失败' : '待上传'}
                    </span>
                  </div>
                  <img
                    src={`/api/records/${screenshotPreview.recordId}/images/${image.id}`}
                    alt="截图"
                    onClick={() => setFullscreenImage({ src: `/api/records/${screenshotPreview.recordId}/images/${image.id}`, alt: image.localPath })}
                    style={{ width: '100%', height: 300, objectFit: 'contain', borderRadius: 8, marginBottom: 12, cursor: 'zoom-in', background: '#f8fafc' }}
                  />
                  <div style={{ fontSize: 12, color: '#666', wordBreak: 'break-all', lineHeight: 1.5 }}>
                    {image.localPath}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {fullscreenImage ? (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: 20
          }}
          onClick={() => setFullscreenImage(null)}
        >
          <button
            type="button"
            onClick={() => setFullscreenImage(null)}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              background: '#fff',
              border: 'none',
              borderRadius: 50,
              width: 40,
              height: 40,
              cursor: 'pointer',
              fontSize: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            
          </button>
          <img
            src={fullscreenImage.src}
            alt={fullscreenImage.alt}
            style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }}
          />
        </div>
      ) : null}
    </>
  );
}
