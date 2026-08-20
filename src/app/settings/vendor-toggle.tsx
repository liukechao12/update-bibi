'use client';

import { useState } from 'react';

type Config = {
  url: string;
  token: string;
  maxRetries: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  batchSize: number;
  timeoutMs: number;
};

export default function VendorToggle({ initialConfig }: { initialConfig: Config }) {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error' | ''>('');
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);

  async function save(partial: Partial<Config>) {
    const next = { ...config, ...partial };
    setConfig(next);
  }

  async function handleSave() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/settings/vendor-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('保存成功，配置已立即生效');
        setTone('success');
        setConfig(data.config);
      } else {
        setMessage(data.message ?? '保存失败');
        setTone('error');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
      setTone('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="grid grid-2" style={{ gap: 16 }}>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>推送接口地址</label>
          <input
            className="input"
            value={config.url}
            onChange={(e) => save({ url: e.target.value })}
            placeholder="https://uat-callback-api.bilibili.cn/api/messages"
          />
        </div>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>
            Token
            <button type="button" className="link-button" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setShowToken((v) => !v)}>
              {showToken ? '隐藏' : '显示'}
            </button>
          </label>
          <input
            className="input"
            type={showToken ? 'text' : 'password'}
            value={config.token}
            onChange={(e) => save({ token: e.target.value })}
            placeholder="输入推送 Token"
          />
        </div>
      </div>

      <div className="grid grid-4" style={{ gap: 16, marginTop: 16 }}>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>最大重试次数</label>
          <input className="input" type="number" min={0} value={config.maxRetries} onChange={(e) => save({ maxRetries: Number(e.target.value) })} />
        </div>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>初始退避（毫秒）</label>
          <input className="input" type="number" min={1000} value={config.backoffInitialMs} onChange={(e) => save({ backoffInitialMs: Number(e.target.value) })} />
        </div>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>最大退避（毫秒）</label>
          <input className="input" type="number" min={10000} value={config.backoffMaxMs} onChange={(e) => save({ backoffMaxMs: Number(e.target.value) })} />
        </div>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>单批最大条数</label>
          <input className="input" type="number" min={1} value={config.batchSize} onChange={(e) => save({ batchSize: Number(e.target.value) })} />
        </div>
      </div>

      <div className="grid grid-4" style={{ gap: 16, marginTop: 16 }}>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>推送超时（毫秒）</label>
          <input className="input" type="number" min={10000} value={config.timeoutMs} onChange={(e) => save({ timeoutMs: Number(e.target.value) })} />
        </div>
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        <button className="button" onClick={handleSave} disabled={loading}>
          {loading ? '保存中...' : '保存配置'}
        </button>
        {message ? (
          <span className="helper" style={{ color: tone === 'success' ? '#0f9d58' : tone === 'error' ? '#d14343' : undefined }}>
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
