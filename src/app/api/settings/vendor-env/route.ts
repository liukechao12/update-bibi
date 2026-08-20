import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import { getPushConfig, setConfig } from '@/lib/push-config';

export async function POST(request: Request) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { url, token, maxRetries, backoffInitialMs, backoffMaxMs, batchSize, timeoutMs } = body as Record<string, unknown>;

  try {
    const updates: Array<[string, string]> = [];
    if (typeof url === 'string' && url.trim()) updates.push(['VENDOR_API_URL', url.trim()]);
    if (typeof token === 'string' && token.trim()) updates.push(['VENDOR_API_TOKEN', token.trim()]);
    if (typeof maxRetries === 'string' || typeof maxRetries === 'number') updates.push(['PUSH_MAX_RETRIES', String(maxRetries)]);
    if (typeof backoffInitialMs === 'string' || typeof backoffInitialMs === 'number') updates.push(['PUSH_BACKOFF_INITIAL_MS', String(backoffInitialMs)]);
    if (typeof backoffMaxMs === 'string' || typeof backoffMaxMs === 'number') updates.push(['PUSH_BACKOFF_MAX_MS', String(backoffMaxMs)]);
    if (typeof batchSize === 'string' || typeof batchSize === 'number') updates.push(['PUSH_BATCH_SIZE', String(batchSize)]);
    if (typeof timeoutMs === 'string' || typeof timeoutMs === 'number') updates.push(['PUSH_TIMEOUT_MS', String(timeoutMs)]);

    for (const [key, value] of updates) {
      await setConfig(key, value);
    }

    const config = await getPushConfig();
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : '保存失败' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const config = await getPushConfig();
  return NextResponse.json({ config });
}
