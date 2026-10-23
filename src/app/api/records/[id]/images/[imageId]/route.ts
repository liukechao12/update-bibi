import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const user = await requireUser();

  const { id, imageId } = await params;

  const record = await prisma.dataRecord.findUnique({
    where: { id },
    select: { id: true, createdById: true }
  });

  if (!record) {
    return NextResponse.json({ code: 40400, message: '记录不存在' }, { status: 404 });
  }

  if (!user.roles?.includes('SUPER_ADMIN') && record.createdById !== user.id) {
    return NextResponse.json({ code: 40300, message: '无权限查看' }, { status: 403 });
  }

  const image = await prisma.recordImage.findUnique({
    where: { id: imageId },
    select: { localPath: true, mimeType: true }
  });

  if (!image) {
    return NextResponse.json({ code: 40400, message: '截图不存在' }, { status: 404 });
  }

  if (!existsSync(image.localPath)) {
    return NextResponse.json({ code: 40400, message: '截图文件不存在' }, { status: 404 });
  }

  const buffer = await readFile(image.localPath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': image.mimeType || 'image/png',
      'Content-Length': buffer.length.toString()
    }
  });
}
