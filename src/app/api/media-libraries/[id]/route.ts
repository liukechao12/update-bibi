import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';

const baseInclude = {
  createdBy: true
} as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const domain = typeof body.domain === 'string' ? body.domain.trim() : undefined;
  const authorName = typeof body.authorName === 'string' ? body.authorName.trim() : undefined;
  const originType = typeof body.originType === 'string' ? body.originType.trim() : undefined;
  const publisherType = typeof body.publisherType === 'string' ? body.publisherType.trim() : undefined;
  const authorType = typeof body.authorType === 'string' ? body.authorType.trim() : undefined;
  const priority = body.priority === undefined ? undefined : Number(body.priority);
  const status = typeof body.status === 'string' ? body.status.trim() : undefined;
  const remark = typeof body.remark === 'string' ? body.remark.trim() : undefined;

  if (name !== undefined && name.length === 0) {
    return NextResponse.json({ code: 40002, message: '名称不能为空' }, { status: 400 });
  }

  if (originType !== undefined && !['media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other'].includes(originType)) {
    return NextResponse.json({ code: 40003, message: '来源类型不合法' }, { status: 400 });
  }

  if (publisherType !== undefined && !['MEDIA', 'SOCIAL'].includes(publisherType)) {
    return NextResponse.json({ code: 40003, message: '发布类型不合法' }, { status: 400 });
  }

  if (authorType !== undefined && authorType !== '' && !['BLUE_V', 'SELF_MEDIA', 'PERSONAL'].includes(authorType)) {
    return NextResponse.json({ code: 40003, message: '作者类型不合法' }, { status: 400 });
  }

  if (status !== undefined && !['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ code: 40003, message: '状态不合法' }, { status: 400 });
  }

  const updated = await prisma.mediaLibrary.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(domain !== undefined ? { domain: domain || null } : {}),
      ...(authorName !== undefined ? { authorName: authorName || null } : {}),
      ...(originType !== undefined ? { originType: originType as never } : {}),
      ...(publisherType !== undefined ? { publisherType: publisherType as never } : {}),
      ...(authorType !== undefined ? { authorType: authorType ? (authorType as never) : null } : {}),
      ...(priority !== undefined && !Number.isNaN(priority) ? { priority } : {}),
      ...(status !== undefined ? { status: status as never } : {}),
      ...(remark !== undefined ? { remark: remark || null } : {})
    },
    include: baseInclude
  });

  return NextResponse.json({ ok: true, mediaLibrary: updated });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;
  const { id } = await params;

  await prisma.mediaLibrary.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
