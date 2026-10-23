import { getPushConfig, getConfig } from '@/lib/push-config';
import { getFreshProxy, invalidateProxy } from '@/lib/proxy-manager';
import { prisma } from '@/lib/prisma';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export type ScreenshotResult = {
  imageBuffer: Buffer;
  mimeType: string;
  size: number;
  sha256: string;
};

export type LocalScreenshotResult = {
  localPath: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
};

export type ImageUploadResult = {
  url: string;
  mimeType: string;
  size: number;
  sha256: string;
};

function getScreenshotDir(): string {
  return process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'data', 'screenshots');
}

async function ensureScreenshotDir(recordId: string): Promise<string> {
  const baseDir = getScreenshotDir();
  const recordDir = path.join(baseDir, recordId);
  await fs.mkdir(recordDir, { recursive: true });
  return recordDir;
}

const SCREENSHOT_MAX_RETRIES = 3;
const SCREENSHOT_RETRY_DELAYS_MS = [1000, 3000];

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return msg.includes('超时') || msg.includes('timeout') || msg.includes('Timeout') ||
    msg.includes('aborted') || msg.includes('abort');
}

function isRetryableScreenshotError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  if (msg.includes('未配置截图服务地址')) return false;
  if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) return false;
  if (isTimeoutError(error)) return true;
  if (msg.includes('ECONNRESET') || msg.includes('socket hang up') || msg.includes('UND_ERR') ||
      msg.includes('HTTP 502') || msg.includes('HTTP 503') || msg.includes('HTTP 504')) {
    return true;
  }
  return false;
}

/** 需要穿代理的域名清单文件；改文件即时生效，不用重启。 */
const DEFAULT_PROXY_HOSTS = ['xiaohongshu.com', 'xhslink.cn'];
let proxyHostsCache: { mtimeMs: number; hosts: string[] } | null = null;

function getProxyHostsFile(): string {
  return process.env.SCREENSHOT_PROXY_HOSTS_FILE || path.join(process.cwd(), 'data', 'proxy-hosts.txt');
}

async function readProxyHosts(): Promise<string[]> {
  const file = getProxyHostsFile();
  try {
    const stat = await fs.stat(file);
    if (proxyHostsCache && proxyHostsCache.mtimeMs === stat.mtimeMs) {
      return proxyHostsCache.hosts;
    }
    const text = await fs.readFile(file, 'utf8');
    const hosts = text
      .split(/\r?\n/)
      .map((line) => line.split('#')[0].trim().toLowerCase())
      .filter(Boolean);
    proxyHostsCache = { mtimeMs: stat.mtimeMs, hosts };
    return hosts;
  } catch {
    // 文件不存在就用内置默认清单
    return DEFAULT_PROXY_HOSTS;
  }
}

async function needsProxy(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const hosts = await readProxyHosts();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function normalizeWaitUntil(waitUntil: string): string {
  /** Browserless 用 Puppeteer 等待语义，没有 Playwright 的 networkidle。 */
  return waitUntil === 'networkidle' ? 'networkidle2' : waitUntil;
}

type RawResponse = { status: number; contentType: string; raw: Buffer };

async function postBrowserless(
  endpoint: string,
  base: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<RawResponse> {
  let response: Response;
  try {
    response = await fetch(`${base}${endpoint}${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(42000)
    });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as { code?: string; message?: string } | undefined) : undefined;
    const detail = cause?.code ?? cause?.message;
    throw new Error(`截图服务请求失败：${error instanceof Error ? error.message : String(error)}${detail ? ` (${detail})` : ''}`);
  }

  const raw = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? '';
  return { status: response.status, contentType, raw };
}

function toScreenshotResult(imageBuffer: Buffer): ScreenshotResult {
  const sha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  let mimeType = 'image/jpeg';
  if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E &&
      imageBuffer[3] === 0x47 && imageBuffer[4] === 0x0D && imageBuffer[5] === 0x0A &&
      imageBuffer[6] === 0x1A && imageBuffer[7] === 0x0A) {
    mimeType = 'image/png';
  }
  return { imageBuffer, mimeType, size: imageBuffer.length, sha256 };
}

async function captureViaDirect(
  base: string,
  token: string,
  url: string,
  waitUntil: string,
  waitAfter: number | undefined,
  signal?: AbortSignal
): Promise<ScreenshotResult> {
  const body: Record<string, unknown> = {
    url,
    gotoOptions: { waitUntil: normalizeWaitUntil(waitUntil), timeout: 30000 },
    // 客户图片接口只收 PNG，JPEG 会被 415 拒掉
    options: { type: 'png' },
    viewport: { width: 1280, height: 800 }
  };
  if (waitAfter && waitAfter > 0) body.waitForTimeout = waitAfter;

  const { status, contentType, raw } = await postBrowserless('/screenshot', base, token, body, signal);
  if (status !== 200 || contentType.includes('json') || contentType.includes('text')) {
    throw new Error(`截图服务错误：HTTP ${status} - ${raw.toString('utf8').substring(0, 200)}`);
  }
  return toScreenshotResult(raw);
}

async function captureViaFunction(
  base: string,
  token: string,
  url: string,
  waitUntil: string,
  waitAfter: number | undefined,
  proxy: string | null,
  signal?: AbortSignal
): Promise<ScreenshotResult> {
  const delay = Number(waitAfter || 0);
  const ctxOptions = proxy ? { proxyServer: proxy } : {};
  const code = `export default async ({ page }) => {
  const ctx = await page.browser().createBrowserContext(${JSON.stringify(ctxOptions)});
  try {
    const p = await ctx.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    const cdp = await p.createCDPSession();
    await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });
    await p.goto(${JSON.stringify(url)}, { waitUntil: ${JSON.stringify(normalizeWaitUntil(waitUntil))}, timeout: 40000 });
    ${delay > 0 ? `await new Promise((resolve) => setTimeout(resolve, ${delay}));` : ''}
    const buf = await p.screenshot({ type: 'png' });
    // 沙箱里没有 Buffer，Uint8Array.toString('base64') 不会做 base64，必须分块 btoa
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) {
      bin += String.fromCharCode.apply(null, Array.prototype.slice.call(buf.subarray(i, i + 8192)));
    }
    return { b64: btoa(bin) };
  } finally { await ctx.close(); }
};`;

  const { status, raw } = await postBrowserless('/function', base, token, { code }, signal);
  const text = raw.toString('utf8');
  if (status !== 200) {
    throw new Error(`截图服务错误：HTTP ${status} - ${text.substring(0, 200)}`);
  }
  let parsed: { b64?: string; error?: string };
  try { parsed = JSON.parse(text); } catch {
    throw new Error(`截图服务返回非 JSON：${text.substring(0, 200)}`);
  }
  if (parsed.error) {
    throw new Error(`${proxy ? '代理' : ''}截图失败：${parsed.error}`);
  }
  if (!parsed.b64) {
    throw new Error(`${proxy ? '代理' : ''}截图返回缺少图片数据`);
  }
  return toScreenshotResult(Buffer.from(parsed.b64, 'base64'));
}

function isCertError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('ERR_CERT') ||
    msg.includes('ERR_SSL') ||
    msg.includes('CERT_AUTHORITY_INVALID') ||
    msg.includes('SSL_PROTOCOL')
  );
}

async function isProxyRelatedError(error: unknown): Promise<boolean> {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('ERR_PROXY') ||
    msg.includes('ERR_TUNNEL') ||
    msg.includes('ERR_CONNECTION') ||
    msg.includes('ERR_TIMED_OUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up') ||
    msg.includes('UND_ERR') ||
    isTimeoutError(error)
  );
}

async function captureScreenshotOnce(
  url: string,
  config: Awaited<ReturnType<typeof getPushConfig>>,
  waitUntil: string,
  waitAfter: number | undefined,
  signal?: AbortSignal
): Promise<ScreenshotResult> {
  const base = (config.screenshotServiceUrl || 'http://127.0.0.1:3100').replace(/\/$/, '');
  const token = config.screenshotServiceApiKey;

  if (!(await needsProxy(url))) {
    try {
      return await captureViaDirect(base, token, url, waitUntil, waitAfter, signal);
    } catch (error) {
      // 直连 500 都是页面级导航错误（证书/被拦等），走 /function 用 CDP 忽略证书再试一次
      const msg = error instanceof Error ? error.message : String(error);
      if (!(isCertError(error) || msg.includes('截图服务错误：HTTP 500'))) throw error;
      return captureViaFunction(base, token, url, waitUntil, waitAfter, null, signal);
    }
  }

  const proxy = await getFreshProxy();
  try {
    return await captureViaFunction(base, token, url, waitUntil, waitAfter, proxy, signal);
  } catch (error) {
    if (await isProxyRelatedError(error)) {
      invalidateProxy();
    }
    throw error;
  }
}

async function captureWithRetries(
  url: string,
  config: Awaited<ReturnType<typeof getPushConfig>>,
  waitUntil: string,
  waitAfter: number | undefined,
  signal?: AbortSignal
): Promise<ScreenshotResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SCREENSHOT_MAX_RETRIES; attempt++) {
    try {
      return await captureScreenshotOnce(url, config, waitUntil, waitAfter, signal);
    } catch (error) {
      lastError = error;
      if (attempt >= SCREENSHOT_MAX_RETRIES || !isRetryableScreenshotError(error)) {
        throw error;
      }
      const delay = SCREENSHOT_RETRY_DELAYS_MS[attempt - 1] ?? SCREENSHOT_RETRY_DELAYS_MS[SCREENSHOT_RETRY_DELAYS_MS.length - 1];
      const errMsg = error instanceof Error ? error.message : String(error);
      // 预算已用完（外层 AbortSignal.timeout 触发）：再重试只会立刻失败并白等延迟
      if (signal?.aborted) {
        console.warn(`截图预算已用尽，停止重试：${url}`);
        throw error;
      }
      console.warn(`截图 (${waitUntil}) 第 ${attempt}/${SCREENSHOT_MAX_RETRIES} 次失败 (${errMsg})，${delay}ms 后重试：${url}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// 调用截图服务获取网页截图
// 策略：先用 domcontentloaded + 2 秒等待（快），如果截图太小（<40KB，可能是视频页面）再用 networkidle 重试
export async function captureScreenshot(url: string, signal?: AbortSignal): Promise<ScreenshotResult> {
  const config = await getPushConfig();

  if (!config.screenshotServiceUrl) {
    throw new Error('未配置截图服务地址（SCREENSHOT_SERVICE_URL）');
  }

  // 第一次尝试：domcontentloaded + 2 秒（快）
  const screenshot = await captureWithRetries(url, config, 'domcontentloaded', 2000, signal);

  // 如果截图太小（<40KB，PNG 体积约为 JPEG 的 3 倍），可能是视频页面或 SPA 未完全渲染，用 networkidle 重试
  if (screenshot.size < 40 * 1024) {
    console.warn(`截图过小 (${(screenshot.size / 1024).toFixed(1)}KB)，用 networkidle 重试：${url}`);
    try {
      const retryScreenshot = await captureWithRetries(url, config, 'networkidle', undefined, signal);
      return retryScreenshot;
    } catch (retryError) {
      // networkidle 也失败，返回第一次的结果
      console.warn(`networkidle 重试失败，使用首次截图：${retryError instanceof Error ? retryError.message : String(retryError)}`);
      return screenshot;
    }
  }

  return screenshot;
}

// 截图并保存到本地，返回本地路径
export async function captureAndSaveScreenshot(
  recordId: string,
  url: string,
  signal?: AbortSignal
): Promise<LocalScreenshotResult> {
  const screenshot = await captureScreenshot(url, signal);
  const recordDir = await ensureScreenshotDir(recordId);
  const timestamp = Date.now();
  const extension = screenshot.mimeType === 'image/png' ? 'png' : 'jpg';
  const filename = `${timestamp}.${extension}`;
  const localPath = path.join(recordDir, filename);

  await fs.writeFile(localPath, screenshot.imageBuffer);

  return {
    localPath,
    mimeType: screenshot.mimeType,
    fileSize: screenshot.size,
    sha256: screenshot.sha256
  };
}

// 从本地文件上传图片到客户接口
export async function uploadLocalImageToVendor(
  localPath: string,
  mimeType: string,
  signal?: AbortSignal
): Promise<ImageUploadResult> {
  const config = await getPushConfig();
  const token = config.token;

  const imageBuffer = await fs.readFile(localPath);

  if (imageBuffer.length > 5 * 1024 * 1024) {
    throw new Error(`图片大小 ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB 超过 5MB 限制`);
  }

  const uploadEndpoint = new URL(config.url);
  uploadEndpoint.pathname = uploadEndpoint.pathname.replace(/\/messages\/?$/, '/messages/images');

  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  const bodyParts: Buffer[] = [];
  const filename = mimeType === 'image/jpeg' ? 'screenshot.jpg' : 'screenshot.png';

  bodyParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  ));
  bodyParts.push(imageBuffer);
  bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(bodyParts);

  const response = await fetch(uploadEndpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${token}`
    },
    body,
    signal: signal ?? AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`图片上传失败：HTTP ${response.status} - ${errorText}`);
  }

  const result = await response.json() as ImageUploadResult;

  if (!result.url || !result.sha256) {
    throw new Error('图片上传响应格式异常，缺少 url 或 sha256');
  }

  return result;
}

// 为记录截图并保存到数据库，截图成功后立即上传到客户接口
export async function captureAndSaveForRecord(
  recordId: string,
  sourceUrl: string,
  signal?: AbortSignal
): Promise<void> {
  const config = await getPushConfig();
  if (!config.screenshotServiceUrl) {
    return;
  }

  // 删除旧的截图记录（重新截图时覆盖）
  const oldImages = await prisma.recordImage.findMany({
    where: { recordId }
  });

  // 删除旧本地文件
  for (const old of oldImages) {
    if (old.localPath) {
      await fs.unlink(old.localPath).catch(() => {});
    }
  }
  if (oldImages.length > 0) {
    await prisma.recordImage.deleteMany({ where: { recordId } });
  }

  try {
    const result = await captureAndSaveScreenshot(recordId, sourceUrl, signal);

    // 检测是否为完全空白截图（PNG 空白页约 4.7KB，<6KB 才算真正空白，视频页面即使小也要上传）
    const isBlankScreenshot = result.fileSize < 6 * 1024;

    // 创建截图记录
    const recordImage = await prisma.recordImage.create({
      data: {
        recordId,
        sourceUrl,
        localPath: result.localPath,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
        sha256: result.sha256,
        uploadStatus: isBlankScreenshot ? 'FAILED' : 'PENDING',
        errorMessage: isBlankScreenshot ? '截图完全空白' : null
      }
    });

    // 只有完全空白的截图才不上传
    if (isBlankScreenshot) {
      console.log(`记录 ${recordId} 截图完全空白 (${(result.fileSize / 1024).toFixed(1)}KB)，跳过上传`);
      return;
    }

    // 立即上传到客户接口
    try {
      const uploadResult = await uploadLocalImageToVendor(result.localPath, result.mimeType);
      await prisma.recordImage.update({
        where: { id: recordImage.id },
        data: {
          vendorUrl: uploadResult.url,
          uploadStatus: 'UPLOADED',
          uploadedAt: new Date()
        }
      });
    } catch (uploadError) {
      const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
      console.error(`记录 ${recordId} 截图上传失败:`, errorMessage);
      await prisma.recordImage.update({
        where: { id: recordImage.id },
        data: {
          uploadStatus: 'FAILED',
          errorMessage
        }
      }).catch(() => {});
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`记录 ${recordId} 截图失败:`, errorMessage);

    await prisma.recordImage.create({
      data: {
        recordId,
        sourceUrl,
        localPath: '',
        mimeType: 'image/png',
        fileSize: 0,
        uploadStatus: 'FAILED',
        errorMessage
      }
    }).catch(() => {
      // 忽略写入失败记录错误
    });
  }
}

// 批量为多条记录截图（异步，不阻塞入库）

/** 与 Browserless 容器的 CONCURRENT=4 对齐：再多只会让请求在服务端排队。 */
const SCREENSHOT_CONCURRENCY = 4;

/** 单条记录的总预算：单次采集 30s + 一次重试。超预算直接降级为"无图"，不拖垮整批推送。 */
const SCREENSHOT_RECORD_BUDGET_MS = 45000;

export async function captureScreenshotsForRecords(
  records: Array<{ id: string; url: string }>
): Promise<void> {
  const config = await getPushConfig();
  if (!config.screenshotServiceUrl) {
    return;
  }

  // 车道式并发：每条车道做完一条立刻领下一条，避免整组被最慢的那条拖住
  const queue = [...records];
  const lanes = Array.from({ length: Math.min(SCREENSHOT_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const record = queue.shift();
      if (!record) return;
      try {
        await captureAndSaveForRecord(record.id, record.url, AbortSignal.timeout(SCREENSHOT_RECORD_BUDGET_MS));
      } catch (error) {
        console.error(`记录 ${record.id} 截图流程异常:`, error instanceof Error ? error.message : String(error));
      }
    }
  });
  await Promise.allSettled(lanes);
}

// 为推送任务上传图片并返回 vendorUrl 映射
export async function uploadImagesForPush(
  recordIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  const images = await prisma.recordImage.findMany({
    where: {
      recordId: { in: recordIds },
      uploadStatus: 'PENDING',
      localPath: { not: '' }
    }
  });

  for (const image of images) {
    try {
      const uploadResult = await uploadLocalImageToVendor(image.localPath, image.mimeType);

      await prisma.recordImage.update({
        where: { id: image.id },
        data: {
          vendorUrl: uploadResult.url,
          uploadStatus: 'UPLOADED',
          uploadedAt: new Date()
        }
      });

      const existing = result.get(image.recordId) ?? [];
      existing.push(uploadResult.url);
      result.set(image.recordId, existing);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await prisma.recordImage.update({
        where: { id: image.id },
        data: {
          uploadStatus: 'FAILED',
          errorMessage
        }
      }).catch(() => {});
    }
  }

  // 也包含已上传的图片
  const uploadedImages = await prisma.recordImage.findMany({
    where: {
      recordId: { in: recordIds },
      uploadStatus: 'UPLOADED',
      vendorUrl: { not: null }
    }
  });

  for (const image of uploadedImages) {
    if (image.vendorUrl) {
      const existing = result.get(image.recordId) ?? [];
      if (!existing.includes(image.vendorUrl)) {
        existing.push(image.vendorUrl);
        result.set(image.recordId, existing);
      }
    }
  }

  return result;
}
