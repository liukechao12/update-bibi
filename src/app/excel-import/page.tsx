'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Progress = {
  total: number;
  screenshot: { done: number; failed: number; pending: number };
  push: { success: number; failed: number; pushing: number; pending: number };
  finished: boolean;
};

type ImportResult = {
  batchNo?: string;
  imported?: number;
  saved?: number;
  invalid?: number;
  affectedRecordIds?: string[];
  invalidRows?: Array<{ rowNo: number; missing: string[] }>;
  results?: Array<{ rowNo: number; textId: string; success: boolean; error?: string }>;
  warning?: string;
  code?: number;
  message?: string;
};

type Phase = 'idle' | 'uploading' | 'background' | 'done';

/** 轮询间隔与上限：截图每条最多 45 秒预算，后台跑完通常在几分钟内。 */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

export default function ExcelImportPage() {
  const router = useRouter();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [recordIds, setRecordIds] = useState<string[]>([]);
  const [progressError, setProgressError] = useState('');
  const pollStartedAt = useRef(0);

  const stopPolling = useCallback(() => setRecordIds([]), []);

  useEffect(() => {
    if (recordIds.length === 0) return;
    if (pollStartedAt.current === 0) pollStartedAt.current = Date.now();

    let cancelled = false;
    async function tick() {
      try {
        const response = await fetch('/api/import/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: recordIds })
        });
        if (cancelled) return;
        if (!response.ok) {
          setProgressError('进度查询失败，可稍后在数据记录页查看结果');
          stopPolling();
          return;
        }
        const payload = (await response.json()) as Progress;
        if (cancelled) return;
        setProgressError('');
        setProgress(payload);
        if (payload.finished) {
          setPhase('done');
          stopPolling();
        } else if (Date.now() - pollStartedAt.current > POLL_TIMEOUT_MS) {
          setProgressError('后台仍在处理，可稍后在数据记录页查看进度');
          setPhase('done');
          stopPolling();
        }
      } catch {
        if (!cancelled) setProgressError('进度查询中断，可稍后在数据记录页查看结果');
      }
    }

    void tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [recordIds, stopPolling]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');
    if (!(file instanceof File)) return;

    setLoading(true);
    setResult(null);
    setProgress(null);
    setProgressError('');
    setRecordIds([]);
    pollStartedAt.current = 0;
    setPhase('uploading');

    try {
      const payload = new FormData();
      payload.append('file', file);

      const response = await fetch('/api/import/excel', {
        method: 'POST',
        body: payload
      });

      if (response.status === 401) {
        router.push('/login');
        return;
      }

      const text = await response.text();
      if (!text) {
        setResult({ message: '服务器返回为空，请检查服务器日志' });
        setPhase('done');
        return;
      }

      let data: ImportResult;
      try {
        data = JSON.parse(text);
      } catch {
        setResult({ message: `服务器返回格式错误: ${text.slice(0, 500)}` });
        setPhase('done');
        return;
      }

      setResult(data);
      if (data.message) {
        setPhase('done');
        return;
      }

      const ids = Array.isArray(data.affectedRecordIds) ? data.affectedRecordIds : [];
      if (ids.length > 0) {
        setPhase('background');
        setRecordIds(ids);
      } else {
        setPhase('done');
      }
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '上传失败' });
      setPhase('done');
    } finally {
      setLoading(false);
    }
  }

  const savedCount = result?.saved ?? 0;
  const screenshotDone = progress?.screenshot.done ?? 0;
  const screenshotFailed = progress?.screenshot.failed ?? 0;
  const screenshotPending = progress?.screenshot.pending ?? 0;
  const pushSuccess = progress?.push.success ?? 0;
  const pushFailed = progress?.push.failed ?? 0;
  const pushInFlight = (progress?.push.pushing ?? 0) + (progress?.push.pending ?? 0);

  const phaseText = phase === 'uploading'
    ? '正在解析 Excel 并保存到数据库...'
    : phase === 'background'
      ? `已保存 ${savedCount} 条，后台正在截图并推送`
      : '';

  const progressPercent = savedCount > 0
    ? Math.min(100, Math.round(((pushSuccess + pushFailed) / savedCount) * 100))
    : 0;

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">Excel 导入</span>
          <h1>上传 Excel 自动导入并推送</h1>
          <p>解析保存后立即返回，截图与推送在后台进行，本页实时显示进度，可以关掉去做别的事。</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">选择文件</h2>
          <form onSubmit={handleUpload}>
            <input className="input" name="file" type="file" accept=".xlsx,.xls" disabled={phase === 'uploading'} />
            <div className="stack" style={{ marginTop: 12 }}>
              <button className="button" type="submit" disabled={phase === 'uploading'}>
                {phase === 'uploading' ? '处理中...' : '上传并导入'}
              </button>
            </div>
          </form>

          {phase !== 'idle' && phase !== 'done' ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ padding: 12, background: '#eef2ff', color: '#4f46e5', borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
                {phaseText}
              </div>
              <div style={{ marginTop: 12, height: 8, background: '#f1f4f9', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: phase === 'uploading' ? '15%' : `${Math.max(20, progressPercent)}%`,
                  background: '#6366f1',
                  transition: 'width 0.5s ease',
                  borderRadius: 999
                }} />
              </div>
              {phase === 'background' ? (
                <ul className="helper" style={{ marginTop: 10, listStyle: 'none', padding: 0, lineHeight: 1.9 }}>
                  <li>截图：成功 {screenshotDone} 条 · 失败 {screenshotFailed} 条 · 处理中 {screenshotPending} 条</li>
                  <li>推送：成功 <span style={{ color: '#0f9d58', fontWeight: 600 }}>{pushSuccess}</span> 条 · 失败 <span style={{ color: '#d14343', fontWeight: 600 }}>{pushFailed}</span> 条 · 待推送 {pushInFlight} 条</li>
                  <li>截图失败的记录会自动降级为不带图推送，不影响入库</li>
                </ul>
              ) : (
                <p className="helper" style={{ marginTop: 8 }}>解析完成后接口立即返回，无需等待截图...</p>
              )}
              {progressError ? (
                <div style={{ marginTop: 10, padding: 12, background: '#fff4e6', color: '#b45309', borderRadius: 12, fontSize: 14 }}>
                  {progressError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">导入结果</h2>

          {!result ? (
            <p className="helper">暂无结果</p>
          ) : result.message ? (
            <div style={{ padding: 12, background: '#fdeaea', color: '#b42318', borderRadius: 12, wordBreak: 'break-all' }}>
              {result.message}
            </div>
          ) : (
            <>
              {result.warning ? (
                <div style={{ marginBottom: 16, padding: 12, background: '#eaf7ef', color: '#0f9d58', borderRadius: 12, fontWeight: 600 }}>
                  {result.warning}
                </div>
              ) : null}

              {progress?.finished ? (
                <div style={{ marginBottom: 16, padding: 12, background: pushFailed > 0 ? '#fff4e6' : '#eaf7ef', color: pushFailed > 0 ? '#b45309' : '#0f9d58', borderRadius: 12, fontWeight: 600 }}>
                  后台处理完成：截图成功 {screenshotDone} 条（失败 {screenshotFailed} 条已降级推送），推送成功 {pushSuccess} 条，失败 {pushFailed} 条
                </div>
              ) : null}

              <table className="table">
                <tbody>
                  <tr><th>批次号</th><td>{result.batchNo ?? '-'}</td></tr>
                  <tr><th>总行数</th><td>{result.imported ?? 0}</td></tr>
                  <tr><th>解析成功</th><td>{savedCount}</td></tr>
                  <tr><th>解析失败</th><td>{result.invalid ?? 0}</td></tr>
                  <tr><th>截图完成</th><td>{screenshotDone + screenshotFailed} / {savedCount}</td></tr>
                  <tr><th>推送成功</th><td style={{ color: '#0f9d58', fontWeight: 600 }}>{pushSuccess}</td></tr>
                  <tr><th>推送失败</th><td style={{ color: '#d14343', fontWeight: 600 }}>{pushFailed}</td></tr>
                </tbody>
              </table>

              {result.invalidRows && result.invalidRows.length > 0 ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '0 0 8px' }}>解析失败行</h3>
                  <table className="table">
                    <thead>
                      <tr><th>行号</th><th>缺失字段</th></tr>
                    </thead>
                    <tbody>
                      {result.invalidRows.map((item) => (
                        <tr key={item.rowNo}>
                          <td>{item.rowNo}</td>
                          <td>{item.missing.length ? item.missing.join('、') : '格式错误'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="stack" style={{ marginTop: 16 }}>
                {result.batchNo ? (
                  <a className="button secondary" href={`/batches/${result.batchNo}`}>查看批次详情</a>
                ) : null}
                <a className="button secondary" href="/push-jobs">查看推送日志</a>
                <a className="button secondary" href="/records">查看数据记录</a>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
