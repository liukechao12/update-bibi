import { getConfig } from '@/lib/push-config';

/** 代理实际有效期 3 分钟，提前 10 秒判过期，避免用到最后几秒的死 IP。 */
const PROXY_SAFE_MARGIN_MS = 10_000;
/** 提取接口没返回 expire 时的兜底有效期：2 分 50 秒。 */
const PROXY_FALLBACK_TTL_MS = 170_000;

type CachedProxy = { proxy: string; expireAt: number };

type ExtractResponse = {
  status?: string | number;
  msg?: string;
  expire?: string;
  list?: Array<{ sever?: string; port?: number | string }>;
};

let cached: CachedProxy | null = null;
let inflight: Promise<CachedProxy> | null = null;

async function extractProxy(): Promise<CachedProxy> {
  const apiUrl = (await getConfig('SCREENSHOT_PROXY_API_URL')).trim();
  if (!apiUrl) {
    throw new Error('未配置代理提取地址（SCREENSHOT_PROXY_API_URL）');
  }

  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`代理提取失败：HTTP ${response.status}`);
  }

  const data = await response.json() as ExtractResponse;
  if (String(data.status) !== '0' || !data.list?.length) {
    throw new Error(`代理提取返回异常：status=${data.status} ${data.msg ?? ''}`.trim());
  }

  const { sever, port } = data.list[0];
  if (!sever || !port) {
    throw new Error('代理提取返回缺少 sever/port');
  }

  const parsedExpire = data.expire ? new Date(data.expire.replace(/-/g, '/')).getTime() : NaN;
  const expireAt = Number.isFinite(parsedExpire)
    ? parsedExpire - PROXY_SAFE_MARGIN_MS
    : Date.now() + PROXY_FALLBACK_TTL_MS;

  return { proxy: `http://${sever}:${port}`, expireAt };
}

/**
 * 取一个仍在有效期内的代理；过期才重新提取。
 * 只有需要代理的截图会调用，不需要代理时不会消耗代理额度。
 */
export async function getFreshProxy(): Promise<string> {
  if (cached && Date.now() < cached.expireAt) {
    return cached.proxy;
  }

  // 多条记录并发截图时共用同一次提取，避免几秒内白拿好几个 IP
  if (!inflight) {
    inflight = extractProxy()
      .then((fresh) => {
        cached = fresh;
        console.log(`[proxy-manager] 提取新代理，有效期至 ${new Date(fresh.expireAt).toISOString()}`);
        return fresh;
      })
      .finally(() => {
        inflight = null;
      });
  }

  const fresh = await inflight;
  return fresh.proxy;
}

/** 当前代理可能已死（截图报网络错误），丢弃缓存让下次重新提取。 */
export function invalidateProxy(): void {
  cached = null;
}
