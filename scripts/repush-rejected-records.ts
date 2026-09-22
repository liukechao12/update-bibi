/**
 * 把「客户整批拒收（单批超过 100 条）却被误标成功」的记录重新按 CREATE 推给客户。
 *
 * 用法：
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/repush-rejected-records.ts          # 只统计
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/repush-rejected-records.ts --apply  # 真正推送
 */
import 'dotenv/config';
import Module from 'module';
import path from 'path';

// ts-node 不认 tsconfig 的 @/ 别名，这里补一层解析
type Resolver = (request: string, ...args: unknown[]) => string;
const nodeModule = Module as unknown as { _resolveFilename: Resolver };
const resolveFilename = nodeModule._resolveFilename;
nodeModule._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  const target = request.startsWith('@/') ? path.join(__dirname, '..', 'src', request.slice(2)) : request;
  return (resolveFilename as (this: unknown, ...args: unknown[]) => string).apply(this, [target, ...rest]);
} as Resolver;

import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../src/lib/env';
import { parseMysqlDatabaseUrl } from '../src/lib/db-config';

const { pushExistingRecords } = require('../src/lib/push-workflow') as typeof import('../src/lib/push-workflow');

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({ ...config, connectionLimit: 5, connectTimeout: 5000 });
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.findFirst({
    where: { roles: { some: { role: { roleCode: 'SUPER_ADMIN' } } } },
    select: { id: true, username: true }
  });
  if (!admin) throw new Error('没有超级管理员账号');

  const rejectedJobs = (await prisma.pushJob.findMany({
    where: { insertedCount: 0, failedCount: { gt: 0 } },
    select: { id: true, responseBody: true }
  })).filter((job) => {
    const body = job.responseBody as { errors?: Array<{ error?: string }> } | null;
    return String(body?.errors?.[0]?.error ?? '').includes('单批超过');
  });

  const items = await prisma.pushJobItem.findMany({
    where: { status: 'FAILED', pushJobId: { in: rejectedJobs.map((job) => job.id) } },
    select: { recordId: true }
  });
  const candidates = Array.from(new Set(items.map((item) => item.recordId)));

  const records = await prisma.dataRecord.findMany({
    where: { id: { in: candidates }, recordStatus: 'PENDING_PUSH' },
    include: { pushItems: { where: { status: 'SUCCESS' }, select: { id: true } } },
    orderBy: { createdAt: 'asc' }
  });
  const targets = records.filter((record) => record.pushItems.length === 0);

  console.log(`操作账号: ${admin.username}`);
  console.log(`整批被拒任务: ${rejectedJobs.length}，候选记录: ${candidates.length}，本次重推(CREATE): ${targets.length}`);
  if (targets.length === 0) return;
  if (!process.argv.includes('--apply')) {
    console.log('[dry-run] 加 --apply 才会真正推送到 UAT');
    return;
  }

  const result = await pushExistingRecords(admin.id, targets.map((record) => record.id));
  const inserted = result.results.reduce((sum, item) => sum + item.inserted, 0);
  const failed = result.results.reduce((sum, item) => sum + item.failed, 0);
  console.log(`批次号: ${result.batchNo}`);
  console.log(`分片数: ${result.results.length}，客户接收 inserted=${inserted}，failed=${failed}`);
  result.results.forEach((item, index) => {
    const reasons = Array.from(new Set((item.errors ?? []).map((entry) => String(entry.error).slice(0, 100))));
    console.log(`  片 ${index + 1}: inserted=${item.inserted} failed=${item.failed}${reasons.length ? ` :: ${reasons.join(' / ')}` : ''}`);
  });

  const after = await prisma.dataRecord.groupBy({
    by: ['recordStatus'],
    where: { id: { in: targets.map((record) => record.id) } },
    _count: { _all: true }
  });
  console.log('重推后记录状态:', JSON.stringify(after));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
