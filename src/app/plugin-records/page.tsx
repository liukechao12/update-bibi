import { Prisma, RecordStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/guards';
import { normalizePublishTimeToDate } from '@/lib/mapping';
import { formatBeijingTime } from '@/lib/time';
import PluginRecordsView from './plugin-records-view';

const PAGE_SIZE = 20;
type SearchParams = Record<string, string | string[] | undefined>;

export default async function PluginRecordsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key].trim() : '';
  const filters = {
    keyword: value('keyword'), clientId: value('clientId'), status: value('status'),
    startDate: value('startDate'), endDate: value('endDate')
  };
  const requestedPage = Number(value('page') || 1);
  const errors: string[] = [];
  const where: Prisma.DataRecordWhereInput = { lastPluginReceivedAt: { not: null } };
  if (filters.keyword) where.OR = [
    { textId: { contains: filters.keyword } }, { title: { contains: filters.keyword } },
    { author: { contains: filters.keyword } }, { url: { contains: filters.keyword } }
  ];
  if (filters.clientId) where.lastPluginClientId = filters.clientId;
  if (filters.status) {
    if (Object.hasOwn(RecordStatus, filters.status)) where.recordStatus = filters.status as RecordStatus;
    else errors.push('请选择有效的推送状态。');
  }
  const dates: { startDate?: Date; endDate?: Date } = {};
  for (const key of ['startDate', 'endDate'] as const) {
    if (!filters[key]) continue;
    const date = normalizePublishTimeToDate(`${filters[key]} 00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(date.getTime())) {
      errors.push(`${key === 'startDate' ? '开始' : '结束'}日期无效。`);
    } else dates[key] = date;
  }
  if (dates.startDate && dates.endDate && dates.startDate > dates.endDate) errors.push('开始日期不能晚于结束日期。');
  where.lastPluginReceivedAt = {
    not: null,
    ...(dates.startDate ? { gte: dates.startDate } : {}),
    ...(dates.endDate ? { lt: new Date(dates.endDate.getTime() + 86400000) } : {})
  };

  const [clients, total] = await Promise.all([
    prisma.externalApiClient.findMany({
      where: { clientCode: { startsWith: 'plugin_' } },
      select: { id: true, clientName: true, clientCode: true },
      orderBy: { clientName: 'asc' }
    }),
    errors.length ? Promise.resolve(0) : prisma.dataRecord.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(totalPages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const records = errors.length ? [] : await prisma.dataRecord.findMany({
    where,
    orderBy: [{ lastPluginReceivedAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
    select: {
      id: true, textId: true, title: true, text: true, url: true, author: true,
      sourceName: true, originType: true, publishTime: true, recordStatus: true,
      lastPluginReceivedAt: true,
      lastPluginClient: { select: { clientName: true, clientCode: true, department: true } },
      pushItems: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
        select: {
          status: true, errorMessage: true, vendorResponseCode: true, pushType: true,
          pushJob: { select: { jobNo: true, createdAt: true, httpStatus: true } }
        }
      }
    }
  });
  return <PluginRecordsView
    filters={filters} clients={clients} total={total} page={page} totalPages={totalPages} errors={errors}
    records={records.map((record) => ({
      id: record.id, textId: record.textId, title: record.title, text: record.text, url: record.url,
      author: record.author, sourceName: record.sourceName, originType: record.originType,
      publishTime: formatBeijingTime(record.publishTime), recordStatus: record.recordStatus,
      receivedAt: formatBeijingTime(record.lastPluginReceivedAt), client: record.lastPluginClient,
      lastPush: record.pushItems[0] ? {
        status: record.pushItems[0].status, errorMessage: record.pushItems[0].errorMessage,
        vendorResponseCode: record.pushItems[0].vendorResponseCode, pushType: record.pushItems[0].pushType,
        jobNo: record.pushItems[0].pushJob.jobNo, httpStatus: record.pushItems[0].pushJob.httpStatus,
        createdAt: formatBeijingTime(record.pushItems[0].pushJob.createdAt)
      } : null
    }))}
  />;
}
