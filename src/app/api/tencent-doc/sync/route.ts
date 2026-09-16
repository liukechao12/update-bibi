import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/api-auth';
import { runTencentDocumentSync } from '@/lib/tencent-document-sync';

export async function POST() {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  try {
    const result = await runTencentDocumentSync('MANUAL');
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : '腾讯文档同步失败' }, { status: 502 });
  }
}
