import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../src/lib/env';
import { parseMysqlDatabaseUrl } from '../src/lib/db-config';

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  ...config,
  connectionLimit: 5,
  connectTimeout: 5000
});

const prisma = new PrismaClient({ adapter });

function readSourceName(rawSourceText: string | null): string | null {
  if (!rawSourceText) return null;
  try {
    const raw = JSON.parse(rawSourceText);
    if (!raw || typeof raw !== 'object') return null;
    const candidate = (raw as Record<string, unknown>)['来源'] ?? (raw as Record<string, unknown>).source;
    if (typeof candidate !== 'string') return null;
    return candidate.trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const BATCH_SIZE = 500;
  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;
  let missing = 0;

  for (;;) {
    const records = await prisma.dataRecord.findMany({
      where: { sourceName: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, rawSourceText: true }
    });
    if (records.length === 0) break;

    for (const record of records) {
      const sourceName = readSourceName(record.rawSourceText);
      if (sourceName) {
        await prisma.dataRecord.update({ where: { id: record.id }, data: { sourceName } });
        updated += 1;
      } else {
        missing += 1;
      }
    }

    scanned += records.length;
    cursor = records[records.length - 1].id;
    console.log(`已扫描 ${scanned} 条...`);
  }

  console.log(`\n完成：回填 sourceName ${updated} 条，rawSourceText 中无来源 ${missing} 条`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
