/**
 * 导入 excel 目录下的 4 个事件 Excel 文件到 EventRecord 表。
 *
 * 用法：
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/import-event-excels.ts
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/import-event-excels.ts --force   # 已导入的分类也会重新导入
 *
 * 幂等性：默认跳过已经导入过的分类（按 category 统计，有数据即跳过）。
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../src/lib/env';
import { parseMysqlDatabaseUrl } from '../src/lib/db-config';

const EXCEL_DIR = path.resolve(__dirname, '../excel');
const BATCH_SIZE = 500;
const force = process.argv.includes('--force');

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  ...config,
  connectionLimit: 5,
  connectTimeout: 5000
});

const prisma = new PrismaClient({ adapter });

// 每个 Excel 文件对应一个分类（去掉扩展名作为分类名）
const FILES = [
  { fileName: '华为竹知了事件.xlsx', category: '华为竹知了事件' },
  { fileName: '叠纸敖尹上线事件.xlsx', category: '叠纸敖尹上线事件' },
  { fileName: '小红书上市投诉事件.xlsx', category: '小红书上市投诉事件' },
  { fileName: '雷军过早事件（6.15-至今）.xlsx', category: '雷军过早事件' }
];

function cellStr(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    const h = String(value.getHours()).padStart(2, '0');
    const min = String(value.getMinutes()).padStart(2, '0');
    const s = String(value.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  if (typeof value === 'object' && 'result' in value && value.result instanceof Date) {
    const dt = value.result;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    const s = String(dt.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }
  return String(value).trim();
}

function toInt(value: string | undefined | null): number {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/[,，\s]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function toDate(value: string): Date | null {
  if (!value) return null;
  const normalized = value.replace(/[./]/g, '-').replace('年', '-').replace('月', '-').replace('日', '');
  const date = new Date(normalized.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getField(raw: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function parseWorkbook(workbook: ExcelJS.Workbook): Array<{ rowNo: number; raw: Record<string, string> }> {
  const rows: Array<{ rowNo: number; raw: Record<string, string> }> = [];
  for (const worksheet of workbook.worksheets) {
    const headerRow = worksheet.getRow(1);
    const headerValues = Array.isArray(headerRow.values) ? headerRow.values : [];
    const headers = headerValues.slice(1).map((value) => cellStr(value as ExcelJS.CellValue));

    for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      if (row.actualCellCount === 0) continue;

      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        raw[header] = cellStr(row.getCell(index + 1).value);
      });

      // 跳过全空行（除了序号列外没有内容）
      const hasContent = Object.values(raw).some((v) => v !== '');
      if (!hasContent) continue;

      rows.push({ rowNo, raw });
    }
  }
  return rows;
}

function mapToEventRecord(
  category: string,
  sourceFileName: string,
  item: { rowNo: number; raw: Record<string, string> }
) {
  const raw = item.raw;
  const link = getField(raw, ['链接地址', '链接', 'link', '链接url']);
  const time = getField(raw, ['时间', '发布时间', '日期']);
  const source = getField(raw, ['来源', '来源类型']);

  return {
    category,
    sourceFileName,
    seqNo: toInt(getField(raw, ['序号', '序'])),
    source,
    author: getField(raw, ['作者', '博主']),
    fansCount: toInt(getField(raw, ['粉丝数'])),
    authType: getField(raw, ['认证类型', '认证']),
    publishTime: toDate(time),
    title: getField(raw, ['标题', '博文标题']),
    link,
    summary: getField(raw, ['摘要', '正文', '内容']),
    viewCount: toInt(getField(raw, ['浏览数', '阅读数', '阅读量', '浏览量'])),
    forwardCount: toInt(getField(raw, ['转载数', '转发数', '转发量'])),
    replyCount: toInt(getField(raw, ['回复数', '评论数', '评论量'])),
    praiseCount: toInt(getField(raw, ['点赞数', '点赞量'])),
    tendency: getField(raw, ['倾向性', '情感倾向']),
    rawData: raw,
    rowNo: item.rowNo
  };
}

async function importFile(item: { fileName: string; category: string }) {
  const fullPath = path.join(EXCEL_DIR, item.fileName);
  if (!fs.existsSync(fullPath)) {
    console.log(`[跳过] 文件不存在：${item.fileName}`);
    return;
  }

  const existingCount = await prisma.eventRecord.count({ where: { category: item.category } });
  if (existingCount > 0 && !force) {
    console.log(`[跳过] 分类「${item.category}」已导入 ${existingCount} 条，如需重新导入请加 --force`);
    return;
  }
  if (existingCount > 0) {
    console.log(`[重导] 分类「${item.category}」已有 ${existingCount} 条，--force 删除后重新导入...`);
    await prisma.eventRecord.deleteMany({ where: { category: item.category } });
  }

  console.log(`[开始] 导入 ${item.fileName}（分类：${item.category}）...`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fullPath);

  const rows = parseWorkbook(workbook);
  console.log(`       共读取 ${rows.length} 条数据行，开始批量写入...`);

  let inserted = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => mapToEventRecord(item.category, item.fileName, row));
    await prisma.eventRecord.createMany({ data: batch });
    inserted += batch.length;

    if (inserted % (BATCH_SIZE * 20) === 0 || inserted === rows.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`       已导入 ${inserted}/${rows.length} 条（耗时 ${elapsed}s）`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[完成] ${item.fileName} 导入 ${inserted} 条，耗时 ${totalElapsed}s`);
}

async function main() {
  if (!fs.existsSync(EXCEL_DIR)) {
    console.error(`目录不存在：${EXCEL_DIR}`);
    process.exit(1);
  }

  console.log('导入目录：' + EXCEL_DIR);
  console.log('分类映射：');
  for (const item of FILES) {
    console.log(`  - ${item.fileName}  =>  ${item.category}`);
  }
  console.log('');

  const overallStart = Date.now();
  for (const item of FILES) {
    await importFile(item);
  }
  const overallElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`\n全部完成，总耗时 ${overallElapsed}s`);

  const stats = await prisma.eventRecord.groupBy({
    by: ['category'],
    _count: { _all: true }
  });
  console.log('\n当前 EventRecord 各分类数据量：');
  for (const s of stats) {
    console.log(`  - ${s.category}: ${s._count._all}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
