import { NextResponse } from 'next/server';
import { getTencentDocConfig, getTencentDocSheetData, getTencentDocSheets, redactTencentDocConfig } from '@/lib/tencent-doc-api';

export async function GET() {
  const config = await getTencentDocConfig();
  try {
    const sheets = await getTencentDocSheets();
    const sheetId = new URLSearchParams(process.env.TENCENT_DOC_TEST_QUERY ?? '').get('sheetId') ?? 'BB08J2';
    const range = new URLSearchParams(process.env.TENCENT_DOC_TEST_QUERY ?? '').get('range') ?? 'A1:Z200';
    const data = await getTencentDocSheetData(sheetId, range);
    return NextResponse.json({ ok: true, config: redactTencentDocConfig(config), sheets, data });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      config: redactTencentDocConfig(config),
      message: error instanceof Error ? error.message : '腾讯文档接口测试失败'
    }, { status: 502 });
  }
}
