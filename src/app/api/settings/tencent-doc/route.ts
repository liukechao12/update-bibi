import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import { getConfig, setConfig } from '@/lib/push-config';

const keys = ['TENCENT_DOC_SYNC_ENABLED', 'TENCENT_DOC_SYNC_TIME', 'TENCENT_DOC_SHEET_ID', 'TENCENT_DOC_SHEET_IDS', 'TENCENT_DOC_RANGE'] as const;

export async function GET() {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;
  const values = await Promise.all(keys.map((key) => getConfig(key)));
  return NextResponse.json({ config: Object.fromEntries(keys.map((key, index) => [key, values[index]])) });
}

export async function POST(request: Request) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const updates: Array<[string, string]> = [
    ['TENCENT_DOC_SYNC_ENABLED', body.enabled ? 'true' : 'false'],
    ['TENCENT_DOC_SYNC_TIME', String(body.syncTime ?? '09:00').trim()],
    ['TENCENT_DOC_SHEET_ID', String(body.sheetId ?? 'BB08J2').trim()],
    ['TENCENT_DOC_SHEET_IDS', String(body.sheetIds ?? 'BB08J2,l266vy,00d86f').trim()],
    ['TENCENT_DOC_RANGE', String(body.range ?? 'A1:Z200').trim()]
  ];
  for (const [key, value] of updates) await setConfig(key, value);
  return NextResponse.json({ ok: true, config: Object.fromEntries(updates) });
}
