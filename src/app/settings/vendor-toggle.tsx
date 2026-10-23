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
  apiVersion: string;
  screenshotServiceUrl: string;
  screenshotServiceApiKey: string;
  screenshotDir: string;
};

export default function VendorToggle({ initialConfig }: { initialConfig: Config }) {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error' | ''>('');
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);

  function save(partial: Partial<Config>) {
    setConfig((current) => ({ ...current, ...partial }));
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
          <input className="input" value={config.url} onChange={(e) => save({ url: e.target.value })} placeholder="https://uat-callback-api.bilibili.cn/api/messages" />
        </div>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>
            Token
            <button type="button" className="link-button" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setShowToken((value) => !value)}>
              {showToken ? '隐藏' : '显示'}
            </button>
          </label>
          <input className="input" type={showToken ? 'text' : 'password'} value={config.token} onChange={(e) => save({ token: e.target.value })} placeholder="输入推送 Token" />
        </div>
      </div>

      <div className="grid grid-4" style={{ gap: 16, marginTop: 16 }}>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>协议版本</label>
          <select className="select" value={config.apiVersion} onChange={(e) => save({ apiVersion: e.target.value })}>
            <option value="2">v2</option>
            <option value="3">v3</option>
            <option value="4">v4（含图片）</option>
          </select>
        </div>
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
      </div>

      <div className="grid grid-4" style={{ gap: 16, marginTop: 16 }}>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>单批最大条数</label>
          <input className="input" type="number" min={1} value={config.batchSize} onChange={(e) => save({ batchSize: Number(e.target.value) })} />
        </div>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>推送超时（毫秒）</label>
          <input className="input" type="number" min={10000} value={config.timeoutMs} onChange={(e) => save({ timeoutMs: Number(e.target.value) })} />
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 16, marginTop: 16 }}>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>截图服务地址</label>
          <input className="input" value={config.screenshotServiceUrl} onChange={(e) => save({ screenshotServiceUrl: e.target.value })} placeholder="http://127.0.0.1:3100" />
          <span className="helper" style={{ display: 'block', marginTop: 4, fontSize: 12, color: '#666' }}>普通网站 + 自动代理（小红书）都在同一个容器</span>
        </div>
        <div>
          <label className="helper" style={{ display: 'block', marginBottom: 6 }}>截图服务 API Key（TOKEN）</label>
          <input className="input" type="password" value={config.screenshotServiceApiKey} onChange={(e) => save({ screenshotServiceApiKey: e.target.value })} placeholder="生成 TOKEN，用于鉴权" />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label className="helper" style={{ display: 'block', marginBottom: 6 }}>截图存储目录</label>
        <input className="input" value={config.screenshotDir} onChange={(e) => save({ screenshotDir: e.target.value })} placeholder="/data/screenshots 或留空使用默认目录" />
        <span className="helper" style={{ display: 'block', marginTop: 4, fontSize: 12, color: '#666' }}>截图文件保存的本地目录，留空则使用 ./data/screenshots</span>
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        <button className="button" onClick={handleSave} disabled={loading}>
          {loading ? '保存中...' : '保存配置'}
        </button>
        {message ? <span className="helper" style={{ color: tone === 'success' ? '#0f9d58' : tone === 'error' ? '#d14343' : undefined }}>{message}</span> : null}
      </div>
    </div>
  );
}
