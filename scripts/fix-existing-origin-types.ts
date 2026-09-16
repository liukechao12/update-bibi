import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../src/lib/env';
import { parseMysqlDatabaseUrl } from '../src/lib/db-config';
import { normalizeOriginType } from '../src/lib/mapping';

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  ...config,
  connectionLimit: 5,
  connectTimeout: 5000
});

const prisma = new PrismaClient({ adapter });

async function main() {
  let fixedMediaLibraries = 0;
  let fixedRecords = 0;

  // 1) 修复 MediaLibrary：按域名/名称重新判断来源类型
  const mediaLibraries = await prisma.mediaLibrary.findMany();
  for (const item of mediaLibraries) {
    const source = item.remark?.startsWith('source=') ? item.remark.slice('source='.length) : (item.name || '');
    const url = item.domain ? `https://${item.domain}` : undefined;
    const correct = normalizeOriginType(source, url);
    if (correct !== item.originType) {
      await prisma.mediaLibrary.update({
        where: { id: item.id },
        data: { originType: correct }
      });
      fixedMediaLibraries += 1;
      console.log(`MediaLibrary ${item.name ?? item.domain}: ${item.originType} -> ${correct}`);
    }
  }

  // 2) 修复 DataRecord：按链接域名 / rawSourceText 里的来源重新判断来源类型
  const BATCH_SIZE = 500;
  let cursor: string | undefined;
  let scanned = 0;
  for (;;) {
    const records = await prisma.dataRecord.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, url: true, originType: true, rawSourceText: true }
    });
    if (records.length === 0) break;

    for (const record of records) {
      let source = '';
      try {
        const raw = record.rawSourceText ? JSON.parse(record.rawSourceText) : null;
        if (raw && typeof raw === 'object' && 'source' in raw) source = String((raw as { source?: unknown }).source ?? '');
      } catch {
        // ignore malformed rawSourceText
      }
      const correct = normalizeOriginType(source, record.url);
      if (correct !== record.originType) {
        await prisma.dataRecord.update({
          where: { id: record.id },
          data: { originType: correct }
        });
        fixedRecords += 1;
      }
    }

    scanned += records.length;
    cursor = records[records.length - 1].id;
    console.log(`已扫描 DataRecord ${scanned} 条...`);
  }

  console.log(`\n完成：修正 MediaLibrary ${fixedMediaLibraries} 条，修正 DataRecord ${fixedRecords} 条`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
