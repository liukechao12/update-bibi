import crypto from 'crypto';
import { PushRecordInput, VendorPushRecordInput } from '@/lib/schemas';
import { PushResponse } from '@/lib/types';
import { getPushConfig } from '@/lib/push-config';

export type PushType = 'CREATE' | 'UPDATE';

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

async function resolveEndpoint(pushType: 'CREATE' | 'UPDATE'): Promise<string> {
  const configured = await getPushConfig().then((c) => c.url);
  if (!configured || configured.includes('replace-with')) {
    throw new Error('未配置客户推送接口地址（VENDOR_API_URL），无法推送');
  }
  
  if (pushType === 'UPDATE') {
    return configured.replace(/\/messages$/, '/messages/revisions');
  }
  
  return configured;
}

export async function buildVendorPushPayload(records: PushRecordInput[], pushType: PushType = 'CREATE') {
  const config = await getPushConfig();
  const apiVersion = String(config.apiVersion ?? '3').trim() || '3';

  const vendorRecords: VendorPushRecordInput[] = records.map((record) => {
    const { crawlTime, ...base } = record;
    const normalized = {
      ...base,
      publisherType: record.publisherType.toLowerCase() as 'media' | 'social',
      authorType: record.authorType ? (record.authorType.toLowerCase() as 'blue_v' | 'self_media' | 'personal') : null
    };

    return apiVersion === '3'
      ? { ...normalized, crawlTime: crawlTime ?? new Date().toISOString() }
      : normalized;
  });

  if (pushType === 'UPDATE') {
    return {
      version: '3',
      records: vendorRecords.map((record) => ({
        textId: record.textId,
        changeType: 'update' as const,
        data: record
      }))
    };
  }

  return { version: apiVersion, records: vendorRecords };
}

export async function pushBatch(
  records: PushRecordInput[],
  token?: string,
  options?: { signal?: AbortSignal; pushType?: PushType; idempotencyKey?: string }
): Promise<PushResponse> {
  const config = await getPushConfig();
  const pushType: PushType = options?.pushType ?? 'CREATE';
  const endpoint = await resolveEndpoint(pushType);
  const finalToken = token ?? config.token;
  const signal = options?.signal;
  const payload = await buildVendorPushPayload(records, pushType);
  const idempotencyKey = pushType === 'UPDATE' ? (options?.idempotencyKey ?? crypto.randomUUID()) : undefined;

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
        Authorization: `Bearer ${finalToken}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify(payload),
      signal
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payloadBody = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

    if (response.ok) {
      const errors = Array.isArray(payloadBody?.errors) ? payloadBody.errors : [];
      return {
        inserted: Number(payloadBody?.inserted ?? records.length),
        failed: Number(payloadBody?.failed ?? 0),
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
      lastError = payloadBody ?? { message: `HTTP ${response.status}` };
      await sleep(getBackoffDelay(attempt, config.backoffInitialMs, config.backoffMaxMs), signal);
      attempt += 1;
      continue;
    }

    return {
      inserted: Number(payloadBody?.inserted ?? 0),
      failed: records.length,
      errors: [{ index: 0, error: payloadBody?.message ?? `HTTP ${response.status}` }]
    };
  }

  throw new Error(`推送失败，已达到最大重试次数: ${JSON.stringify(lastError)}`);
}

export function decidePushType(record: {
  pushItems: Array<{ 
    status: string;
    pushType?: string | null;
    previousCommentNum?: number | null;
    previousForwardNum?: number | null;
    previousPraiseNum?: number | null;
    previousViewNum?: number | null;
  }>;
  commentNum: number;
  forwardNum: number | null;
  praiseNum: number | null;
  viewNum: number | null;
  recordStatus?: string;
}): PushType | 'SKIP' {
  const successfulPush = record.pushItems.find((item) => item.status === 'SUCCESS');
  if (!successfulPush) return 'CREATE';

  const hasInteractionChange = 
    successfulPush.previousCommentNum !== record.commentNum ||
    successfulPush.previousForwardNum !== record.forwardNum ||
    successfulPush.previousPraiseNum !== record.praiseNum ||
    successfulPush.previousViewNum !== record.viewNum;

  return hasInteractionChange ? 'UPDATE' : 'SKIP';
}
