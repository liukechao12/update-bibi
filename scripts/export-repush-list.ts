/**
 * 导出「2026-09-22 补推」的数据清单（客户整批拒收后重新提交的那批）。
 *
 * 用法：
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/export-repush-list.ts
 * 产出：
 *   补推数据清单-2026-09-22.xlsx
 */
import 'dotenv/config';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../src/lib/env';
import { parseMysqlDatabaseUrl } from '../src/lib/db-config';
import { originTypeLabelMap } from '../src/lib/labels';

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({ ...config, connectionLimit: 5, connectTimeout: 5000 });
const prisma = new PrismaClient({ adapter });

const REPUSH_BATCH_NO = process.argv.find((arg) => arg.startsWith('--batch='))?.split('=')[1] ?? 'PUSH-20260922104741032-55B04723';
const OUTPUT = process.argv.find((arg) => arg.startsWith('--out='))?.split('=')[1] ?? '补推数据清单-2026-09-22.xlsx';

const bj = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});

function formatBeijing(value: Date | null | undefined) {
  return value ? bj.format(value).replace('T', ' ').replace(',', ' ') : '';
}

async function main() {
  const repushBatch = await prisma.dataBatch.findFirst({ where: { batchNo: REPUSH_BATCH_NO } });
  if (!repushBatch) throw new Error(`找不到补推批次 ${REPUSH_BATCH_NO}`);

  const repushJobs = await prisma.pushJob.findMany({
    where: { batchId: repushBatch.id },
    select: { id: true, jobNo: true, createdAt: true },
    orderBy: { createdAt: 'asc' }
  });
  const repushItems = await prisma.pushJobItem.findMany({
    where: { pushJobId: { in: repushJobs.map((job) => job.id) } },
    select: { recordId: true, pushJobId: true, status: true }
  });
  const repushedAt = new Map<string, Date>();
  for (const item of repushItems) {
    const job = repushJobs.find((entry) => entry.id === item.pushJobId);
    if (job) repushedAt.set(item.recordId, job.createdAt);
  }

  // 之前被整批拒收的任务（客户返回「单批超过 100 条」）
  const rejectedJobs = (await prisma.pushJob.findMany({
    where: { insertedCount: 0, failedCount: { gt: 0 } },
    select: { id: true, jobNo: true, createdAt: true, responseBody: true }
  })).filter((job) => {
    const body = job.responseBody as { errors?: Array<{ error?: string }> } | null;
    return String(body?.errors?.[0]?.error ?? '').includes('单批超过');
  });

  const rejectedItems = await prisma.pushJobItem.findMany({
    where: { pushJobId: { in: rejectedJobs.map((job) => job.id) } },
    select: { recordId: true, pushJobId: true }
  });
  const firstRejectedAt = new Map<string, { at: Date; jobNo: string }>();
  for (const item of rejectedItems) {
    const job = rejectedJobs.find((entry) => entry.id === item.pushJobId);
    if (!job) continue;
    const existing = firstRejectedAt.get(item.recordId);
    if (!existing || job.createdAt < existing.at) firstRejectedAt.set(item.recordId, { at: job.createdAt, jobNo: job.jobNo });
  }

  const records = await prisma.dataRecord.findMany({
    where: { id: { in: Array.from(repushedAt.keys()) } },
    select: {
      id: true, textId: true, title: true, author: true, originType: true, url: true,
      publishTime: true, createdAt: true, recordStatus: true, sourceName: true,
      batch: { select: { batchNo: true, importType: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('补推数据清单');
  sheet.columns = [
    { header: '序号', key: 'no', width: 6 },
    { header: '内容标识 textId', key: 'textId', width: 34 },
    { header: '标题', key: 'title', width: 50 },
    { header: '作者', key: 'author', width: 18 },
    { header: '来源平台', key: 'origin', width: 12 },
    { header: '内容发布时间', key: 'publishTime', width: 18 },
    { header: '我方入库时间', key: 'createdAt', width: 18 },
    { header: '首次推送时间（被整批拒收）', key: 'firstPushAt', width: 24 },
    { header: '补推时间', key: 'repushAt', width: 18 },
    { header: '补推结果', key: 'result', width: 12 },
    { header: '链接', key: 'url', width: 60 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const stats = { origin: new Map<string, number>(), publishDays: new Map<string, number>(), firstPushDays: new Map<string, number>() };
  records.forEach((record, index) => {
    const rejected = firstRejectedAt.get(record.id);
    sheet.addRow({
      no: index + 1,
      textId: record.textId,
      title: record.title,
      author: record.author,
      origin: originTypeLabelMap[record.originType] ?? record.originType,
      publishTime: formatBeijing(record.publishTime),
      createdAt: formatBeijing(record.createdAt),
      firstPushAt: rejected ? `${formatBeijing(rejected.at)}（${rejected.jobNo}）` : '',
      repushAt: formatBeijing(repushedAt.get(record.id)),
      result: record.recordStatus === 'SUCCESS' ? '已接收' : record.recordStatus,
      url: record.url
    });
    stats.origin.set(record.originType, (stats.origin.get(record.originType) ?? 0) + 1);
    const day = formatBeijing(record.publishTime).slice(0, 10);
    stats.publishDays.set(day, (stats.publishDays.get(day) ?? 0) + 1);
    if (rejected) {
      const rday = formatBeijing(rejected.at).slice(0, 10);
      stats.firstPushDays.set(rday, (stats.firstPushDays.get(rday) ?? 0) + 1);
    }
  });

  await workbook.xlsx.writeFile(OUTPUT);

  console.log(`补推批次: ${REPUSH_BATCH_NO}`);
  console.log(`记录条数: ${records.length}（全部已接收: ${records.every((r) => r.recordStatus === 'SUCCESS')}）`);
  console.log(`来源分布: ${[...stats.origin.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${originTypeLabelMap[k] ?? k} ${v}`).join('，')}`);
  const publishDays = [...stats.publishDays.entries()].sort();
  console.log(`发布时间范围: ${publishDays[0]?.[0]} ~ ${publishDays[publishDays.length - 1]?.[0]}`);
  console.log(`发布时间分布: ${publishDays.map(([k, v]) => `${k}=${v}`).join('，')}`);
  console.log(`首次推送日期分布: ${[...stats.firstPushDays.entries()].sort().map(([k, v]) => `${k}=${v}`).join('，')}`);
  const delays = records
    .map((record) => {
      const rejected = firstRejectedAt.get(record.id);
      const repush = repushedAt.get(record.id);
      return rejected && repush ? (repush.getTime() - rejected.at.getTime()) / 3600000 : null;
    })
    .filter((value): value is number => value !== null);
  console.log(`延迟小时数: 最小 ${Math.min(...delays).toFixed(1)}，最大 ${Math.max(...delays).toFixed(1)}，中位 ${delays.slice().sort((a, b) => a - b)[Math.floor(delays.length / 2)].toFixed(1)}`);
  console.log(`已导出: ${OUTPUT}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
