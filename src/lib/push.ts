import { PushRecordInput } from '@/lib/schemas';
import { PushResponse } from '@/lib/types';
import { getPushConfig } from '@/lib/push-config';

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function getBackoffDelay(attempt: number, initialMs: number, maxMs: number) {
  return Math.min(initialMs * 2 ** attempt, maxMs);
}

function getAppBaseUrl() {
  return process.env.APP_BASE_URL ?? 'http://localhost:3000';
}

async function resolveEndpoint(): Promise<string> {
  const configured = await getPushConfig().then((c) => c.url);
  if (!configured || configured.includes('replace-with')) {
    return new URL('/api/mock-vendor/messages', getAppBaseUrl()).toString();
  }
  return configured;
}

export async function pushBatch(
  records: PushRecordInput[],
  token?: string,
  options?: { signal?: AbortSignal }
): Promise<PushResponse> {
  const config = await getPushConfig();
  const endpoint = await resolveEndpoint();
  const finalToken = token ?? config.token;
  const signal = options?.signal;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < config.maxRetries) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finalToken}`
      },
      body: JSON.stringify({ version: '1', records }),
      signal
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

    if (response.ok) {
      const errors = Array.isArray(payload?.errors) ? payload.errors : [];
      return {
        inserted: Number(payload?.inserted ?? records.length),
        failed: Number(payload?.failed ?? 0),
        errors
      };
    }

    const retryAfter = response.headers.get('retry-after');
    if (response.status === 429) {
      const delayMs = retryAfter ? Number(retryAfter) * 1000 : getBackoffDelay(attempt, config.backoffInitialMs, config.backoffMaxMs);
      await sleep(Number.isFinite(delayMs) ? delayMs : getBackoffDelay(attempt, config.backoffInitialMs, config.backoffMaxMs), signal);
      attempt += 1;
      continue;
    }

    if (response.status >= 500) {
      lastError = payload ?? { message: `HTTP ${response.status}` };
      await sleep(getBackoffDelay(attempt, config.backoffInitialMs, config.backoffMaxMs), signal);
      attempt += 1;
      continue;
    }

    return {
      inserted: Number(payload?.inserted ?? 0),
      failed: records.length,
      errors: [{ index: 0, error: payload?.message ?? `HTTP ${response.status}` }]
    };
  }

  throw new Error(`推送失败，已达到最大重试次数: ${JSON.stringify(lastError)}`);
}
