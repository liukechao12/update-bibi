'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type PreviewResponse = {
  total?: number;
  saved?: number;
  savedRecordIds?: string[];
  preview?: Array<Record<string, unknown>>;
  missingFields?: Array<{ index: number; missing: string[] }>;
  rawBlocks?: string[];
  warning?: string;
  canPush?: boolean;
  code?: number;
  message?: string;
};

export default function DataEntryPage() {
  const router = useRouter();
  const [sourceText, setSourceText] = useState('');
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasMissing = useMemo(
    () => Boolean(result?.missingFields?.some((item) => item.missing.length > 0)),
    [result]
  );

  async function handleParse() {
    setSubmitting(true);
    try {
      const response = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceText })
      });
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      const payload: PreviewResponse = await response.json();
      setResult(payload);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePush() {
    if (!result?.savedRecordIds?.length || result.canPush === false) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/push/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: result.savedRecordIds })
      });
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      const payload = await response.json();
      setResult((current) => ({
        ...current,
        warning: response.ok ? `已保存并提交推送，批次号：${payload.batchNo ?? '-'}` : payload?.message ?? '推送失败'
      }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">数据录入</span>
          <h1>粘贴文本并自动解析</h1>
          <p>点击“解析预览”只做解析并保存；点击“预览后推送”则是在保存后再执行一次推送。</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">粘贴原始数据</h2>
          <textarea
            className="textarea"
            placeholder={
              '倾向性:负面\n来源:新浪微博\n作者:xxx\n粉丝数:123\n时间:2026-07-30 22:03\n标题:...\n链接:https://...\n摘要:...\n评论数:0\n转发数:0\n\n倾向性:负面\n来源:新浪微博\n作者:xxx\n粉丝数:12\n时间:2026-07-30 22:27\n标题:...\n链接:https://...\n摘要:...\n评论数:0\n转发数:0'
            }
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
          />
          <div className="stack" style={{ marginTop: 12 }}>
            <button className="button" onClick={handleParse} disabled={submitting}>
              {submitting ? '处理中...' : '解析预览'}
            </button>
            <button className="button secondary" onClick={handlePush} disabled={submitting || !result?.savedRecordIds?.length}>
              预览后推送
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">解析结果</h2>
          {result?.warning ? (
            <div className="badge" style={{ marginBottom: 12, background: hasMissing ? '#fff4e6' : '#eaf7ef', color: hasMissing ? '#b45309' : '#0f9d58' }}>
              {result.warning}
            </div>
          ) : null}

          {typeof result?.saved === 'number' ? (
            <p className="helper">已保存 {result.saved} 条待推送记录</p>
          ) : null}

          {result?.missingFields?.length ? (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px' }}>缺失项提示</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>块序号</th>
                    <th>缺失字段</th>
                  </tr>
                </thead>
                <tbody>
                  {result.missingFields.map((item) => (
                    <tr key={item.index}>
                      <td>{item.index + 1}</td>
                      <td>{item.missing.length ? item.missing.join('、') : '无'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result ? JSON.stringify(result, null, 2) : '暂无结果'}</pre>
        </div>
      </div>
    </main>
  );
}
