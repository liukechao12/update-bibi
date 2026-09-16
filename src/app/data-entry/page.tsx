'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type PreviewResponse = {
  total?: number;
  saved?: number;
  updated?: number;
  savedRecordIds?: string[];
  preview?: Array<Record<string, unknown>>;
  missingFields?: Array<{ index: number; missing: string[] }>;
  rawBlocks?: string[];
  warning?: string;
  canPush?: boolean;
  requiresTendency?: boolean;
  code?: number;
  message?: string;
};

const tendencyOptions = ['负面', '中性', '正面'] as const;

export default function DataEntryPage() {
  const router = useRouter();
  const [sourceText, setSourceText] = useState('');
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showTendencyDialog, setShowTendencyDialog] = useState(false);
  const [selectedTendency, setSelectedTendency] = useState<(typeof tendencyOptions)[number]>('负面');

  const hasMissing = useMemo(
    () => Boolean(result?.missingFields?.some((item) => item.missing.length > 0)),
    [result]
  );

  async function submitParse(tendency?: string) {
    const response = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceText, ...(tendency ? { tendency } : {}) })
    });

    if (response.status === 401) {
      router.push('/login');
      return;
    }

    const payload: PreviewResponse = await response.json();
    if (response.status === 422 && payload.requiresTendency) {
      setResult(payload);
      setShowTendencyDialog(true);
      return;
    }

    setResult(payload);
  }

  async function handleParse() {
    setSubmitting(true);
    try {
      await submitParse();
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmTendency() {
    setSubmitting(true);
    try {
      setShowTendencyDialog(false);
      await submitParse(selectedTendency);
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
          <p>字段可任意顺序排列；支持“【字段】内容”和“字段:内容”两种格式。已存在但内容或互动数变化时会更新为待推送。</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">粘贴原始数据</h2>
          <textarea
            className="textarea"
            placeholder={
              '【简述】现在开B站大会员跟把钱撕了没什么区别。看电影还要付费，内容阉割。。。#b站 #会员\n【标题】现在开B站大会员跟把钱撕了没什么区别。看电影还要付费，内容阉割。。。#b站 #会员\n【链接】https://www.douyin.com/share/video/7681153001448377626\n【来源】抖音\n【作者】用户867949913\n【时间】2026-09-03 11:56\n【粉丝数】5\n【评论数】0\n\n【来源】微博\n【评论数】2\n【链接】https://weibo.com/example\n【简述】字段顺序可以任意调整\n【作者】示例用户\n【标题】第二条示例\n【时间】2026-09-03 12:00'
            }
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
          />
          <p className="helper" style={{ marginTop: 8 }}>“倾向性”可以不填；点击解析后会提示你统一选择负面、中性或正面。</p>
          <div className="stack" style={{ marginTop: 12 }}>
            <button className="button" onClick={handleParse} disabled={submitting}>
              {submitting ? '处理中...' : '解析预览'}
            </button>
            <button className="button secondary" onClick={handlePush} disabled={submitting || !result?.savedRecordIds?.length || result.canPush === false}>
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
            <p className="helper">本次可推送 {result.saved} 条，其中更新已有记录 {result.updated ?? 0} 条。</p>
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

      {showTendencyDialog ? (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', background: 'rgba(15, 23, 42, 0.45)', padding: 20 }}>
          <div className="card" style={{ width: 'min(460px, 100%)', padding: 24 }}>
            <h2 className="section-title">请选择倾向性</h2>
            <p className="helper">检测到粘贴内容中没有填写“倾向性”。本次未填写倾向性的记录将使用你的选择。</p>
            <div className="stack" style={{ marginTop: 16 }}>
              {tendencyOptions.map((item) => (
                <label key={item} className="helper" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="tendency" value={item} checked={selectedTendency === item} onChange={() => setSelectedTendency(item)} />
                  {item}
                </label>
              ))}
            </div>
            <div className="stack" style={{ marginTop: 20 }}>
              <button className="button" type="button" onClick={confirmTendency} disabled={submitting}>确认并解析</button>
              <button className="button secondary" type="button" onClick={() => setShowTendencyDialog(false)} disabled={submitting}>取消</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
