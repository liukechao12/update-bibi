import { requireAdmin } from '@/lib/guards';
import { getPushConfig } from '@/lib/push-config';
import VendorToggle from './vendor-toggle';

export default async function SettingsPage() {
  await requireAdmin();

  const config = await getPushConfig();

  const initialConfig = {
    url: config.url,
    token: config.token,
    maxRetries: config.maxRetries,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
    batchSize: config.batchSize,
    timeoutMs: config.timeoutMs
  };

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">系统配置</span>
          <h1>接口地址、Token 与重试参数</h1>
          <p>所有配置保存后立即生效，推送时实时读取。</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h2 className="section-title">供应商推送接口</h2>
        <VendorToggle initialConfig={initialConfig} />
      </div>

      <div className="card" style={{ padding: 20, marginTop: 20 }}>
        <h2 className="section-title">参数说明</h2>
        <table className="table">
          <thead>
            <tr>
              <th>参数</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>推送接口地址</td><td>客户接口完整地址，例如 https://uat-callback-api.bilibili.cn/api/messages</td></tr>
            <tr><td>Token</td><td>客户提供的鉴权 Token，会以 Bearer 方式发送</td></tr>
            <tr><td>最大重试次数</td><td>遇到 429 或 5xx 时的最大重试次数</td></tr>
            <tr><td>初始退避</td><td>第一次重试前等待的毫秒数</td></tr>
            <tr><td>最大退避</td><td>退避时间的上限，毫秒</td></tr>
            <tr><td>单批最大条数</td><td>一次推送请求最多包含的记录数</td></tr>
            <tr><td>推送超时</td><td>单次推送最长等待时间，超过则判定为超时失败</td></tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
