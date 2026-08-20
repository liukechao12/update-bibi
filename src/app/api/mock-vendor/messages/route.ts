import { NextResponse } from 'next/server';
import { pushRequestSchema } from '@/lib/schemas';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = pushRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 40002,
        message: parsed.error.issues[0]?.message ?? '请求体校验失败'
      },
      { status: 400 }
    );
  }

  const errors = parsed.data.records
    .map((record, index) => {
      if (record.originType === 'other') return { index, error: '模拟失败：other 类型暂不接收' };
      if (!record.publisherType) return { index, error: '模拟失败：publisherType 缺失' };
      if (record.originType === 'media' && record.publisherType !== 'MEDIA') return { index, error: '模拟失败：media 必须对应 media publisherType' };
      return { index, error: record.textId.includes('fail') ? '模拟失败：textId 包含 fail' : null };
    })
    .filter((item) => item.error);

  return NextResponse.json({
    inserted: parsed.data.records.length - errors.length,
    failed: errors.length,
    errors
  });
}
