'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { labelOrValue, originTypeLabelMap, recordStatusLabelMap } from '@/lib/labels';
import { safeHref } from '@/lib/safe-url';

type RecordItem = {
  id: string;
  textId: string;
  title: string;
  text: string;
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
  isDuplicate: boolean;
  rawSourceText: string | null;
  batchId: string | null;
  batchNo: string | null;
  createdByName: string | null;
  createdAt: string;
};

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

function resolveRaw(record: RecordItem) {
  if (!record.rawSourceText) return null;
  try {
    return JSON.stringify(JSON.parse(record.rawSourceText), null, 2);
  } catch {
    return record.rawSourceText;
  }
}

export default function RecordRow({ record }: { record: RecordItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const tone = statusTone(record.recordStatus);
  const raw = resolveRaw(record);
  const canPush = record.recordStatus === 'PENDING_PUSH';

  async function handlePush() {
    setPushing(true);
    setErrorMessage('');
    try {
      const response = await fetch('/api/push/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: [record.id] })
      });
      const payload = await response.json();
      if (!response.ok) {
        setErrorMessage(payload.message ?? '推送失败');
        return;
      }
      setErrorMessage('');
      router.refresh();
    } finally {
      setPushing(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button type="button" className="link-button" onClick={() => setOpen((value) => !value)}>
            {open ? '▼' : '▶'}
          </button>
        </td>
        <td>
          <Link href={`/records/${record.id}`}>{record.textId}</Link>
        </td>
        <td>{record.title.slice(0, 50)}{record.title.length > 50 ? '...' : ''}</td>
        <td>{record.author}</td>
        <td>{labelOrValue(originTypeLabelMap, record.originType)}</td>
        <td>
          <span style={{ background: tone.bg, color: tone.color, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
            {labelOrValue(recordStatusLabelMap, record.recordStatus)}
          </span>
        </td>
        <td>{record.batchNo ? <Link href={`/batches/${record.batchId ?? ''}`}>{record.batchNo}</Link> : '-'}</td>
        <td>{record.createdByName ?? '-'}</td>
        <td>{record.createdAt}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={9} style={{ background: '#f8fafc', padding: 20 }}>
            <div className="grid grid-2" style={{ gap: 20 }}>
              <div>
                <h3 style={{ margin: '0 0 8px' }}>解析保存内容</h3>
                <table className="table">
                  <tbody>
                    <tr><th>textId</th><td>{record.textId}</td></tr>
                    <tr><th>标题</th><td>{record.title}</td></tr>
                    <tr><th>作者</th><td>{record.author}</td></tr>
                    <tr><th>来源</th><td>{labelOrValue(originTypeLabelMap, record.originType)}（{record.originType}）</td></tr>
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
                  {record.text}
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
                    <button className="button" type="button" onClick={handlePush} disabled={pushing}>
                      {pushing ? '推送中...' : '推送这条记录'}
                    </button>
                  </div>
                ) : null}

                {errorMessage ? (
                  <div style={{ marginTop: 12, background: '#fdeaea', color: '#b42318', border: '1px solid #f5c2c7', padding: 12, borderRadius: 12 }}>
                    {errorMessage}
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
