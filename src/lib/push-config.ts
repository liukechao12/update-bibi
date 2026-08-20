import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

export const CONFIG_KEYS = {
  VENDOR_API_URL: 'VENDOR_API_URL',
  VENDOR_API_TOKEN: 'VENDOR_API_TOKEN',
  PUSH_MAX_RETRIES: 'PUSH_MAX_RETRIES',
  PUSH_BACKOFF_INITIAL_MS: 'PUSH_BACKOFF_INITIAL_MS',
  PUSH_BACKOFF_MAX_MS: 'PUSH_BACKOFF_MAX_MS',
  PUSH_BATCH_SIZE: 'PUSH_BATCH_SIZE',
  PUSH_TIMEOUT_MS: 'PUSH_TIMEOUT_MS'
} as const;

export const CONFIG_DEFAULTS: Record<string, string> = {
  VENDOR_API_URL: 'https://uat-callback-api.bilibili.cn/api/messages',
  VENDOR_API_TOKEN: env.VENDOR_API_TOKEN,
  PUSH_MAX_RETRIES: '5',
  PUSH_BACKOFF_INITIAL_MS: '5000',
  PUSH_BACKOFF_MAX_MS: '300000',
  PUSH_BATCH_SIZE: '100',
  PUSH_TIMEOUT_MS: '300000'
};

const cache = new Map<string, { value: string; ts: number }>();
const CACHE_TTL = 30_000;

export async function getConfig(key: string): Promise<string> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.value;
  }

  const row = await prisma.systemConfig.findUnique({ where: { configKey: key } });
  const value = row?.configValue ?? CONFIG_DEFAULTS[key] ?? '';

  cache.set(key, { value, ts: Date.now() });
  return value;
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await prisma.systemConfig.findMany();
  const dbMap = Object.fromEntries(rows.map((row) => [row.configKey, row.configValue]));
  const result: Record<string, string> = {};
  for (const key of Object.keys(CONFIG_DEFAULTS)) {
    result[key] = dbMap[key] ?? CONFIG_DEFAULTS[key];
  }
  return result;
}

export async function setConfig(key: string, value: string) {
  await prisma.systemConfig.upsert({
    where: { configKey: key },
    create: { configKey: key, configValue: value, configType: 'STRING' },
    update: { configValue: value }
  });
  cache.delete(key);
}

export async function getVendorApiUrl(): Promise<string> {
  return getConfig(CONFIG_KEYS.VENDOR_API_URL);
}

export async function getVendorApiToken(): Promise<string> {
  return getConfig(CONFIG_KEYS.VENDOR_API_TOKEN);
}

export async function getPushConfig() {
  const [url, token, maxRetries, backoffInitial, backoffMax, batchSize, timeoutMs] = await Promise.all([
    getConfig(CONFIG_KEYS.VENDOR_API_URL),
    getConfig(CONFIG_KEYS.VENDOR_API_TOKEN),
    getConfig(CONFIG_KEYS.PUSH_MAX_RETRIES),
    getConfig(CONFIG_KEYS.PUSH_BACKOFF_INITIAL_MS),
    getConfig(CONFIG_KEYS.PUSH_BACKOFF_MAX_MS),
    getConfig(CONFIG_KEYS.PUSH_BATCH_SIZE),
    getConfig(CONFIG_KEYS.PUSH_TIMEOUT_MS)
  ]);

  return {
    url,
    token,
    maxRetries: Math.max(0, Number(maxRetries) || 0),
    backoffInitialMs: Math.max(1000, Number(backoffInitial) || 5000),
    backoffMaxMs: Math.max(10000, Number(backoffMax) || 300000),
    batchSize: Math.max(1, Number(batchSize) || 100),
    timeoutMs: Math.max(10000, Number(timeoutMs) || 300000)
  };
}
