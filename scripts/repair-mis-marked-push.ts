import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../src/lib/env';
import { parseMysqlDatabaseUrl } from '../src/lib/db-config';

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({ ...config, connectionLimit: 5, connectTimeout: 5000 });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes('--apply');

type JobInfo = {
  id: string;
  jobNo: string;
  insertedCount: number | null;
  failedCount: number | null;
  responseBody: unknown;
  createdAt: Date;
};

function rejectReason(job: JobInfo): string {
  const body = job.responseBody as { errors?: Array<{ error?: string }>; message?: string; error?: string } | null;
  return body?.errors?.[0]?.error ?? body?.message ?? body?.error ?? '客户整批拒收（inserted=0）';
}

async function main() {
  // 客户一条都没收（inserted=0）却报了 failed>0 的任务：整批被拒，明细不可能有成功
  const jobs = (await prisma.pushJob.findMany({
    where: { insertedCount: 0, failedCount: { gt: 0 } },
    select: { id: true, jobNo: true, insertedCount: true, failedCount: true, responseBody: true, createdAt: true }
  })) as JobInfo[];

  const misItems = await prisma.pushJobItem.findMany({
    where: { status: 'SUCCESS', pushJobId: { in: jobs.map((job) => job.id) } },
    select: { id: true, recordId: true, pushJobId: true }
  });

  const recordIds = Array.from(new Set(misItems.map((item) => item.recordId)));
  const stillGood = await prisma.pushJobItem.findMany({
    where: { recordId: { in: recordIds }, status: 'SUCCESS', pushJobId: { notIn: jobs.map((job) => job.id) } },
    select: { recordId: true }
  });
  const goodRecordIds = new Set(stillGood.map((item) => item.recordId));
  const brokenRecordIds = recordIds.filter((id) => !goodRecordIds.has(id));

  const successRecords = await prisma.dataRecord.findMany({
    where: { id: { in: brokenRecordIds }, recordStatus: 'SUCCESS' },
    select: { id: true }
  });

  console.log(`整批被拒的任务数: ${jobs.length}`);
  console.log(`误标 SUCCESS 的明细数: ${misItems.length}`);
  console.log(`涉及记录数: ${recordIds.length}，其中还有其它成功推送的: ${goodRecordIds.size}`);
  console.log(`需要改回 PENDING_PUSH 的记录数: ${successRecords.length}`);
  for (const job of jobs.slice(0, 10)) {
    console.log(`  ${job.jobNo} ${job.createdAt.toISOString().slice(0, 10)} failed=${job.failedCount} 原因=${rejectReason(job).slice(0, 80)}`);
  }

  if (!APPLY) {
    console.log('\n[dry-run] 加 --apply 才会真正写库');
    return;
  }

  const itemUpdate = await prisma.pushJobItem.updateMany({
    where: { id: { in: misItems.map((item) => item.id) } },
    data: { status: 'FAILED' }
  });

  // 明细的错误原因按所属任务回填
  for (const job of jobs) {
    const ids = misItems.filter((item) => item.pushJobId === job.id).map((item) => item.id);
    if (ids.length === 0) continue;
    await prisma.pushJobItem.updateMany({
      where: { id: { in: ids } },
      data: { errorMessage: rejectReason(job).slice(0, 500) }
    });
  }

  const recordUpdate = await prisma.dataRecord.updateMany({
    where: { id: { in: successRecords.map((record) => record.id) } },
    data: { recordStatus: 'PENDING_PUSH' }
  });

  console.log(`\n已更新明细 ${itemUpdate.count} 条为 FAILED`);
  console.log(`已更新记录 ${recordUpdate.count} 条为 PENDING_PUSH`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
