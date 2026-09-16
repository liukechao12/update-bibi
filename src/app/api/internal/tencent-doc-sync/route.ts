import { NextResponse } from 'next/server';
import { getConfig, CONFIG_KEYS } from '@/lib/push-config';
import { runTencentDocumentSync } from '@/lib/tencent-document-sync';

export async function POST(request: Request) {
  const secret = await getConfig(CONFIG_KEYS.TENCENT_DOC_SYNC_SECRET);
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!secret || provided !== secret) return NextResponse.json({ code: 40101, message: '定时同步密钥无效' }, { status: 401 });

  const enabled = await getConfig(CONFIG_KEYS.TENCENT_DOC_SYNC_ENABLED);
  if (enabled !== 'true') return NextResponse.json({ ok: true, skipped: true, message: '自动同步未启用' });

  const configuredTime = await getConfig(CONFIG_KEYS.TENCENT_DOC_SYNC_TIME);
  const current = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  if (current !== configuredTime) return NextResponse.json({ ok: true, skipped: true, message: '当前不是配置的同步时间' });

  try {
    return NextResponse.json({ ok: true, result: await runTencentDocumentSync('SCHEDULED') });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : '定时同步失败' }, { status: 502 });
  }
}
