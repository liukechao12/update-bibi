'use client';

import { useState } from 'react';

type Props = { initialConfig: { enabled: string; syncTime: string; sheetId: string; sheetIds: string; range: string } };

export default function TencentDocSync({ initialConfig }: Props) {
  const [config, setConfig] = useState(initialConfig);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    const response = await fetch('/api/settings/tencent-doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    const data = await response.json();
    setMessage(response.ok ? '配置已保存' : data.message ?? '保存失败');
    setLoading(false);
  }

  async function test() {
    setLoading(true);
    const response = await fetch('/api/tencent-doc/test');
    const data = await response.json();
    setMessage(response.ok && data.ok ? '腾讯文档连接成功，已读取工作表数据' : data.message ?? '读取失败');
    setLoading(false);
  }

  async function sync() {
    setLoading(true);
    const response = await fetch('/api/tencent-doc/sync', { method: 'POST' });
    const data = await response.json();
    setMessage(response.ok ? `同步完成：新增 ${data.result?.createdCount ?? 0} 条，更新 ${data.result?.updatedCount ?? 0} 条，跳过 ${data.result?.skippedCount ?? 0} 条` : data.message ?? '同步失败');
    setLoading(false);
  }

  return (
    <div>
      <div className="grid grid-4" style={{ gap: 16 }}>
        <label className="helper">启用自动同步<select className="select" value={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.value })}><option value="true">启用</option><option value="false">停用</option></select></label>
        <label className="helper">每日同步时间<input className="input" type="time" value={config.syncTime} onChange={(event) => setConfig({ ...config, syncTime: event.target.value })} /></label>
        <label className="helper">工作表 ID（兼容旧配置）<input className="input" value={config.sheetId} onChange={(event) => setConfig({ ...config, sheetId: event.target.value })} /></label>
        <label className="helper">多个工作表 ID<input className="input" value={config.sheetIds} onChange={(event) => setConfig({ ...config, sheetIds: event.target.value })} /></label>
        <label className="helper">读取范围<input className="input" value={config.range} onChange={(event) => setConfig({ ...config, range: event.target.value })} /></label>
      </div>
      <p className="helper" style={{ marginTop: 12 }}>当前腾讯文档通过 v3 在线表格 API 读取，不需要 Excel 下载链接。多个工作表用英文逗号分隔，默认纳入社媒、小红书和小红书二次回扫数据。</p>
      <div className="stack" style={{ marginTop: 16 }}>
        <button className="button" type="button" onClick={save} disabled={loading}>保存同步配置</button>
        <button className="button secondary" type="button" onClick={test} disabled={loading}>测试读取</button>
        <button className="button secondary" type="button" onClick={sync} disabled={loading}>立即同步</button>
        {message ? <span className="helper">{message}</span> : null}
      </div>
    </div>
  );
}
