import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { captureAndSaveForRecord } from '@/lib/image-service';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();

  const { id } = await params;

  const record = await prisma.dataRecord.findUnique({
    where: { id },
    select: { id: true, url: true, createdById: true }
  });

  if (!record) {
    return NextResponse.json({ code: 40400, message: '记录不存在' }, { status: 404 });
  }

  if (!user.roles?.includes('SUPER_ADMIN') && record.createdById !== user.id) {
    return NextResponse.json({ code: 40300, message: '无权限操作其他人的记录' }, { status: 403 });
  }

  if (!record.url) {
    return NextResponse.json({ code: 40001, message: '记录没有 URL，无法截图' }, { status: 400 });
  }

  try {
    await captureAndSaveForRecord(record.id, record.url);
    return NextResponse.json({ ok: true, message: '截图已触发' });
  } catch (error) {
    console.error('手动截图失败:', error);
    return NextResponse.json(
      { code: 50000, message: error instanceof Error ? error.message : '截图失败' },
      { status: 500 }
    );
  }
}
