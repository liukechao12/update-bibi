import crypto from 'crypto';
import { PushRecordInput, vendorPushRecordSchema } from '@/lib/schemas';
import { normalizePublishTime } from '@/lib/mapping';
import { PushResponse } from '@/lib/types';
import { getPushConfig } from '@/lib/push-config';

export type PushType = 'CREATE' | 'UPDATE';

// 推送给客户前的记录形态：互动指标可能因媒体采集能力被置为 null
export type OutgoingPushRecord = Omit<PushRecordInput, 'commentNum' | 'forwardNum' | 'praiseNum'> & {
  commentNum: number;
  forwardNum: number | null;
  praiseNum: number | null;
};

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

export async function resolveEndpoint(pushType: 'CREATE' | 'UPDATE'): Promise<string> {
  const configured = await getPushConfig().then((c) => c.url);
  if (!configured || configured.includes('replace-with')) {
    throw new Error('未配置客户推送接口地址（VENDOR_API_URL），无法推送');
  }
  
  if (pushType === 'UPDATE') {
    const endpoint = new URL(configured);
    if (!/\/messages\/?$/.test(endpoint.pathname)) throw new Error('客户新增接口地址必须以 /messages 结尾');
    endpoint.pathname = endpoint.pathname.replace(/\/messages\/?$/, '/messages/revisions');
    return endpoint.toString();
  }

  return configured;
}

export function mapPushFailures(payload: PushResponse, itemCount: number) {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const located = new Map<number, { error: string; code?: string | number | null }>();
  for (const entry of errors) {
    const index = entry?.index;
    if (Number.isInteger(index) && index >= 0 && index < itemCount) {
      located.set(index, { error: entry.error ?? '推送失败', code: (entry as { code?: string | number | null }).code });
    }
  }

  if (Number.isInteger(payload.failed) && Number.isInteger(payload.inserted) && payload.failed >= 0 &&
      payload.inserted >= 0 && payload.failed + payload.inserted === itemCount &&
      payload.failed === located.size && errors.length === located.size) return located;

  // 失败数与错误索引无法对齐时，不能推断其余记录已被接收。
  const reason = errors[0]?.error ?? `客户回执无法确认逐条结果（inserted=${payload.inserted}，failed=${payload.failed}）`;
  return new Map(Array.from({ length: itemCount }, (_, index) => [index, {
    error: reason,
    code: (errors[0] as { code?: string | number | null } | undefined)?.code
  }]));
}

export async function buildVendorPushPayload(records: OutgoingPushRecord[], pushType: PushType = 'CREATE') {
  if (records.length < 1 || records.length > 100) throw new Error('单次推送必须为 1 至 100 条');
  const config = await getPushConfig();
  const apiVersion = pushType === 'UPDATE' ? '3' : String(config.apiVersion ?? '3').trim() || '3';

  const vendorRecords = records.map((record) => {
    if (apiVersion === '3' && !record.crawlTime) throw new Error(`${record.textId} 缺少抓取时间`);
    const normalized = vendorPushRecordSchema.parse({
      ...record,
      publishTime: normalizePublishTime(record.publishTime),
      publisherType: record.publisherType.toLowerCase(),
      authorType: record.authorType?.toLowerCase() ?? null
    });
    const { crawlTime, ...base } = normalized;
    return apiVersion === '3' ? { ...base, crawlTime } : base;
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
  records: OutgoingPushRecord[],
  token?: string,
  options?: { signal?: AbortSignal; pushType?: PushType; idempotencyKey?: string }
): Promise<PushResponse> {
  const config = await getPushConfig();
  const pushType: PushType = options?.pushType ?? 'CREATE';
  const endpoint = await resolveEndpoint(pushType);
  const finalToken = token ?? config.token;
  const signal = options?.signal ?? AbortSignal.timeout(config.timeoutMs);
  const payload = await buildVendorPushPayload(records, pushType);
  const idempotencyKey = pushType === 'UPDATE' ? (options?.idempotencyKey ?? crypto.randomUUID()) : undefined;
  let lastError: unknown;
  let lastHttpStatus = 500;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    signal.throwIfAborted();
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
      if (!payloadBody || !Number.isInteger(payloadBody.inserted) || !Number.isInteger(payloadBody.failed) ||
          payloadBody.inserted < 0 || payloadBody.failed < 0 || payloadBody.inserted + payloadBody.failed !== records.length ||
          !Array.isArray(payloadBody.errors) || payloadBody.errors.some((entry: { index?: unknown; error?: unknown } | null) =>
            !entry || !Number.isInteger(entry.index) || typeof entry.error !== 'string')) {
        throw new Error('客户回执格式异常，无法确认接收结果，请核对后再重试');
      }
      const failures = mapPushFailures(payloadBody, records.length);
      return {
        inserted: records.length - failures.size,
        failed: failures.size,
        httpStatus: response.status,
        errors: Array.from(failures, ([index, error]) => ({ index, ...error }))
      };
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = payloadBody ?? { message: `HTTP ${response.status}` };
      lastHttpStatus = response.status;
      if (attempt === config.maxRetries) break;
      const retryAfter = response.headers.get('retry-after');
      const retryMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
      const delayMs = Number.isFinite(retryMs)
        ? Math.max(0, Math.min(retryMs, config.backoffMaxMs))
        : getBackoffDelay(attempt, config.backoffInitialMs, config.backoffMaxMs);
      await sleep(delayMs, signal);
      continue;
    }

    const reason = String(payloadBody?.message ?? payloadBody?.errors?.[0]?.error ?? `HTTP ${response.status}`);
    return {
      inserted: 0,
      failed: records.length,
      httpStatus: response.status,
      errors: records.map((_, index) => ({ index, error: reason }))
    };
  }

  throw Object.assign(new Error(`推送失败，已达到最大重试次数: ${JSON.stringify(lastError)}`), { httpStatus: lastHttpStatus });
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
  if (record.recordStatus === 'PENDING_PUSH' || record.recordStatus === 'FAILED') return 'UPDATE';

  const hasInteractionChange = 
    successfulPush.previousCommentNum !== record.commentNum ||
    successfulPush.previousForwardNum !== record.forwardNum ||
    successfulPush.previousPraiseNum !== record.praiseNum ||
    successfulPush.previousViewNum !== record.viewNum;

  return hasInteractionChange ? 'UPDATE' : 'SKIP';
}
