'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type ImportResult = {
  batchNo?: string;
  imported?: number;
  saved?: number;
  pushed?: number;
  pushFailed?: number;
  invalid?: number;
  missingRows?: Array<{ rowNo: number; missing: string[] }>;
  results?: Array<{ rowNo: number; textId: string; success: boolean; error?: string }>;
  warning?: string;
  code?: number;
  message?: string;
};

type Phase = 'idle' | 'parsing' | 'pushing' | 'done';

export default function ExcelImportPage() {
  const router = useRouter();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');
    if (!(file instanceof File)) return;

    setLoading(true);
    setResult(null);
    setPhase('parsing');

    try {
      const payload = new FormData();
      payload.append('file', file);

      setPhase('parsing');
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await fetch('/api/import/excel', {
        method: 'POST',
        body: payload
      });

      if (response.status === 401) {
        router.push('/login');
        return;
      }

      setPhase('pushing');

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
      setPhase('done');
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '上传失败' });
      setPhase('done');
    } finally {
      setLoading(false);
    }
  }

  const pushedCount = result?.pushed ?? 0;
  const failedCount = result?.pushFailed ?? 0;
  const savedCount = result?.saved ?? 0;

  const phaseText = phase === 'parsing'
    ? '正在解析 Excel 并保存到数据库...'
    : phase === 'pushing'
      ? `已保存 ${savedCount} 条，正在逐条推送...（共 ${savedCount} 条）`
      : '';

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">Excel 导入</span>
          <h1>上传 Excel 自动导入并推送</h1>
          <p>先解析保存到数据库，再逐条推送，可实时查看进度。</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">选择文件</h2>
          <form onSubmit={handleUpload}>
            <input className="input" name="file" type="file" accept=".xlsx,.xls" disabled={loading} />
            <div className="stack" style={{ marginTop: 12 }}>
              <button className="button" type="submit" disabled={loading}>
                {loading ? '处理中...' : '上传并推送'}
              </button>
            </div>
          </form>

          {loading ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ padding: 12, background: '#eef2ff', color: '#4f46e5', borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
                {phaseText}
              </div>
              <div style={{ marginTop: 12, height: 8, background: '#f1f4f9', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: phase === 'parsing' ? '30%' : phase === 'pushing' ? '70%' : '100%',
                  background: 'linear-gradient(90deg, #6366f1, #818cf8)',
                  transition: 'width 0.5s ease',
                  borderRadius: 999
                }} />
              </div>
              <p className="helper" style={{ marginTop: 8 }}>
                数据量大时请耐心等待，每条推送完成后状态会实时更新...
              </p>
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">导入与推送结果</h2>

          {!result ? (
            <p className="helper">暂无结果</p>
          ) : result.message ? (
            <div style={{ padding: 12, background: '#fdeaea', color: '#b42318', borderRadius: 12, wordBreak: 'break-all' }}>
              {result.message}
            </div>
          ) : (
            <>
              {result.warning ? (
                <div style={{ marginBottom: 16, padding: 12, background: failedCount > 0 ? '#fff4e6' : '#eaf7ef', color: failedCount > 0 ? '#b45309' : '#0f9d58', borderRadius: 12, fontWeight: 600 }}>
                  {result.warning}
                </div>
              ) : null}

              <table className="table">
                <tbody>
                  <tr><th>批次号</th><td>{result.batchNo ?? '-'}</td></tr>
                  <tr><th>总行数</th><td>{result.imported ?? 0}</td></tr>
                  <tr><th>解析成功</th><td>{result.saved ?? 0}</td></tr>
                  <tr><th>解析失败</th><td>{result.invalid ?? 0}</td></tr>
                  <tr><th>推送成功</th><td style={{ color: '#0f9d58', fontWeight: 600 }}>{pushedCount}</td></tr>
                  <tr><th>推送失败</th><td style={{ color: '#d14343', fontWeight: 600 }}>{failedCount}</td></tr>
                </tbody>
              </table>

              {result.missingRows && result.missingRows.length > 0 ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '0 0 8px' }}>解析失败行</h3>
                  <table className="table">
                    <thead>
                      <tr><th>行号</th><th>缺失字段</th></tr>
                    </thead>
                    <tbody>
                      {result.missingRows.map((item) => (
                        <tr key={item.rowNo}>
                          <td>{item.rowNo}</td>
                          <td>{item.missing.length ? item.missing.join('、') : '格式错误'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {result.results && result.results.some((item) => !item.success) ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '0 0 8px' }}>推送失败明细</h3>
                  <table className="table">
                    <thead>
                      <tr><th>行号</th><th>textId</th><th>失败原因</th></tr>
                    </thead>
                    <tbody>
                      {result.results.filter((item) => !item.success).map((item) => (
                        <tr key={item.rowNo}>
                          <td>{item.rowNo}</td>
                          <td>{item.textId}</td>
                          <td style={{ color: '#d14343' }}>{item.error ?? '-'}</td>
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
