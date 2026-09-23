import { NextResponse } from 'next/server';
import { pushRequestSchema } from '@/lib/schemas';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireApiUser } from '@/lib/api-auth';
import { pushExistingRecords, saveParsedRecordsOnly } from '@/lib/push-workflow';

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  let recordIds: string[];
  try {
    if (Array.isArray(body?.recordIds) && body.recordIds.length > 0) {
      if (body.recordIds.some((id: unknown) => typeof id !== 'string' || !id.trim())) {
        return NextResponse.json({ code: 40002, message: '记录 ID 不合法' }, { status: 400 });
      }
      recordIds = body.recordIds;
    } else {
      const parsed = pushRequestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ code: 40002, message: parsed.error.issues[0]?.message ?? '请求体校验失败' }, { status: 400 });
      }
      const saved = await saveParsedRecordsOnly(auth.user.id, parsed.data.records);
      recordIds = saved.createdRecords.map((record) => record.id);
    }

    const result = await pushExistingRecords(auth.user.id, recordIds);
    return NextResponse.json({ ...result, batches: result.results.length });
  } catch (error) {
    return NextResponse.json({ code: 50000, message: error instanceof Error ? error.message : '推送失败' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '';
  const userId = searchParams.get('userId') ?? '';
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';
  const where: Prisma.PushJobWhereInput = {};

  if (status) where.status = status as unknown as Prisma.EnumPushJobStatusFilter;
  if (!auth.user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = auth.user.id;
  } else if (userId) {
    where.createdById = userId;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59`);
  }

  const jobs = await prisma.pushJob.findMany({
    where,
    include: { batch: true, createdBy: { select: { id: true, username: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return NextResponse.json({ jobs });
}
