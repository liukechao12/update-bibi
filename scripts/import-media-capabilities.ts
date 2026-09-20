import 'dotenv/config';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../src/lib/env';
import { parseMysqlDatabaseUrl } from '../src/lib/db-config';

const [filePath, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!filePath) {
  console.error('用法: npx ts-node --compiler-options \'{"module":"commonjs"}\' scripts/import-media-capabilities.ts <xlsx路径> [--dry-run]');
  process.exit(1);
}

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({ ...config, connectionLimit: 5, connectTimeout: 5000 });
const prisma = new PrismaClient({ adapter });

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const withText = value as { text?: unknown; result?: ExcelJS.CellValue };
    if (typeof withText.text === 'string') return withText.text.trim();
    if (withText.text && typeof withText.text === 'object') {
      const richText = (withText.text as { richText?: Array<{ text?: string }> }).richText;
      if (Array.isArray(richText)) return richText.map((part) => part.text ?? '').join('').trim();
    }
    if (withText.result !== undefined) return cellText(withText.result);
    return '';
  }
  return String(value).trim();
}

// 表格约定：0=可采集，"null"/空=不可采集；其余数字按可采集处理并保留原值供核对
function toCollectable(value: ExcelJS.CellValue): { collectable: boolean; kind: string } {
  if (value === null || value === undefined) return { collectable: false, kind: '空' };
  if (typeof value === 'number') return { collectable: true, kind: String(value) };
  const text = cellText(value);
  if (!text) return { collectable: false, kind: '空' };
  if (text.toLowerCase() === 'null') return { collectable: false, kind: 'null' };
  const num = Number(text.replace(/,/g, ''));
  if (Number.isFinite(num)) return { collectable: true, kind: text };
  return { collectable: false, kind: `异常:${text}` };
}

type ParsedRow = {
  sourceName: string;
  category: string;
  commentCollectable: boolean;
  forwardCollectable: boolean;
  praiseCollectable: boolean;
  kinds: string[];
};

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const rows: ParsedRow[] = [];
  for (const worksheet of workbook.worksheets) {
    const headers = (worksheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(cellText);
    const iName = headers.indexOf('来源网站');
    const iComment = headers.indexOf('评论/回复数');
    const iForward = headers.indexOf('转发数');
    const iPraise = headers.indexOf('点赞数');
    if (iName < 0 || iComment < 0 || iForward < 0 || iPraise < 0) {
      console.log(`跳过 sheet「${worksheet.name}」：表头缺少 来源网站/评论/回复数/转发数/点赞数`);
      continue;
    }

    for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      const sourceName = cellText(row.getCell(iName + 1).value);
      if (!sourceName) continue;
      const comment = toCollectable(row.getCell(iComment + 1).value);
      const forward = toCollectable(row.getCell(iForward + 1).value);
      const praise = toCollectable(row.getCell(iPraise + 1).value);
      rows.push({
        sourceName,
        category: worksheet.name,
        commentCollectable: comment.collectable,
        forwardCollectable: forward.collectable,
        praiseCollectable: praise.collectable,
        kinds: [comment.kind, forward.kind, praise.kind]
      });
    }
  }

  if (rows.length === 0) {
    console.error('没有解析到任何数据行');
    process.exitCode = 1;
    return;
  }

  const grouped = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    grouped.set(row.sourceName, [...(grouped.get(row.sourceName) ?? []), row]);
  }

  const conflicts = [...grouped.entries()].filter(([, items]) =>
    items.some((item) =>
      item.commentCollectable !== items[0].commentCollectable ||
      item.forwardCollectable !== items[0].forwardCollectable ||
      item.praiseCollectable !== items[0].praiseCollectable
    )
  );

  const stats = {
    comment: rows.filter((row) => row.commentCollectable).length,
    forward: rows.filter((row) => row.forwardCollectable).length,
    praise: rows.filter((row) => row.praiseCollectable).length
  };
  console.log(`解析完成：数据行 ${rows.length}，去重后媒体 ${grouped.size} 个`);
  console.log(`可采集统计：评论 ${stats.comment}，转发 ${stats.forward}，点赞 ${stats.praise}`);
  if (conflicts.length > 0) {
    console.log('同名媒体在不同 sheet 标记不一致（按后出现的 sheet 覆盖）：');
    for (const [name, items] of conflicts) {
      console.log(`  - ${name}: ${items.map((item) => `${item.category}[${item.kinds.join(',')}]`).join(' vs ')}`);
    }
  }

  if (dryRun) {
    console.log('\n[dry-run] 样例前 10 条：');
    for (const row of rows.slice(0, 10)) {
      console.log(`  ${row.category} | ${row.sourceName} | 评论=${row.commentCollectable} 转发=${row.forwardCollectable} 点赞=${row.praiseCollectable} | 原值[${row.kinds.join(',')}]`);
    }
    console.log('\n[dry-run] 未写入数据库');
    return;
  }

  let created = 0;
  let updated = 0;
  for (const [sourceName, items] of grouped) {
    const last = items[items.length - 1];
    const existing = await prisma.mediaMetricCapability.findUnique({ where: { sourceName } });
    if (existing) {
      await prisma.mediaMetricCapability.update({
        where: { id: existing.id },
        data: {
          category: last.category,
          commentCollectable: last.commentCollectable,
          forwardCollectable: last.forwardCollectable,
          praiseCollectable: last.praiseCollectable
        }
      });
      updated += 1;
    } else {
      await prisma.mediaMetricCapability.create({
        data: {
          sourceName,
          category: last.category,
          commentCollectable: last.commentCollectable,
          forwardCollectable: last.forwardCollectable,
          praiseCollectable: last.praiseCollectable,
          remark: 'Excel 导入'
        }
      });
      created += 1;
    }
  }

  console.log(`\n导入完成：新增 ${created} 个媒体，更新 ${updated} 个媒体`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
