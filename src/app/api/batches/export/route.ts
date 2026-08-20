import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { batchStatusLabelMap, importTypeLabelMap, labelOrValue } from '@/lib/labels';

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '';
  const importType = searchParams.get('importType') ?? '';
  const keyword = searchParams.get('keyword') ?? '';

  const where: Record<string, unknown> = {};
  if (keyword) {
    where.OR = [
      { batchNo: { contains: keyword } },
      { sourceFileName: { contains: keyword } },
      { remark: { contains: keyword } }
    ];
  }
  if (status) where.status = status;
  if (importType) where.importType = importType;
  if (!auth.user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = auth.user.id;
  }

  const batches = await prisma.dataBatch.findMany({
    where: where as never,
    orderBy: { createdAt: 'desc' },
    include: { createdBy: true, _count: { select: { records: true, pushJobs: true } } }
  });

  const header = ['批次号', '创建人', '导入方式', '状态', '总条数', '有效条数', '无效条数', '记录数', '推送任务数', '创建时间', '备注'];
  const rows = batches.map((batch) => [
    batch.batchNo,
    batch.createdBy.displayName,
    labelOrValue(importTypeLabelMap, batch.importType),
    labelOrValue(batchStatusLabelMap, batch.status),
    batch.totalCount,
    batch.validCount,
    batch.invalidCount,
    batch._count.records,
    batch._count.pushJobs,
    batch.createdAt.toISOString(),
    batch.remark ?? ''
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="batches-export.csv"'
    }
  });
}
