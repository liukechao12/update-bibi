import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/api-auth';
import { labelOrValue, originTypeLabelMap, recordStatusLabelMap } from '@/lib/labels';

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

// 导出查询的 include 选择，单独提出来避免在 findMany 里推断时自引用
const exportInclude = { batch: { include: { createdBy: true } } } as const satisfies Prisma.DataRecordInclude;

type ExportRecord = Prisma.DataRecordGetPayload<{
  include: typeof exportInclude;
}> & { sourceDepartment: string | null };

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '';
  const originType = searchParams.get('originType') ?? '';
  const keyword = searchParams.get('keyword') ?? '';
  const submitter = searchParams.get('submitter') ?? '';
  const sourceDepartment = searchParams.get('sourceDepartment') ?? '';
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';

  const where: Record<string, unknown> = {};
  if (keyword) {
    where.OR = [
      { textId: { contains: keyword } },
      { title: { contains: keyword } },
      { author: { contains: keyword } },
      { url: { contains: keyword } }
    ];
  }
  if (status) where.recordStatus = status;
  if (originType) where.originType = originType;
  if (sourceDepartment) where.sourceDepartment = sourceDepartment;
  if (submitter && auth.user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = submitter;
  } else if (!auth.user.roles?.includes('SUPER_ADMIN')) {
    where.createdById = auth.user.id;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
    if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(`${endDate}T23:59:59`);
  }

  const records = (await prisma.dataRecord.findMany({
    where: where as never,
    orderBy: { createdAt: 'desc' },
    include: exportInclude
  })) as ExportRecord[];
  const header = [
    'textId',
    '标题',
    '作者',
    '来源',
    '来源部门',
    '状态',
    '评论数',
    '转发数',
    '点赞数',
    '阅读数',
    '批次号',
    '提交人',
    '创建时间',
    '发布时间',
    '链接',
    '正文'
  ];

  const rows = records.map((record) => [
    record.textId,
    record.title,
    record.author,
    labelOrValue(originTypeLabelMap, record.originType),
    record.sourceDepartment ?? '',
    labelOrValue(recordStatusLabelMap, record.recordStatus),
    record.commentNum,
    record.forwardNum ?? '',
    record.praiseNum ?? '',
    record.viewNum ?? '',
    record.batch?.batchNo ?? '',
    record.batch?.createdBy?.displayName ?? '',
    record.createdAt.toISOString(),
    record.publishTime.toISOString(),
    record.url,
    record.text
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="records-export.csv"'
    }
  });
}
