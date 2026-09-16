import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

(async () => {
  const prisma = new PrismaClient();
  const batchNo = 'BATCH-20260916192320182-6AC1C121';

  const batch = await prisma.dataBatch.findUnique({
    where: { batchNo },
    include: {
      records: {
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          textId: true,
          recordStatus: true,
          originType: true,
          publisherType: true,
          authorType: true,
          author: true,
          sourceRowNo: true,
          updatedAt: true,
          rawSourceText: true
        }
      },
      createdBy: { select: { id: true, username: true, displayName: true } },
      importFiles: true,
      pushJobs: {
        select: {
          id: true,
          jobNo: true,
          status: true,
          pushType: true,
          insertedCount: true,
          failedCount: true,
          httpStatus: true,
          createdAt: true,
          responseBody: true
        }
      }
    }
  });

  const around =
    batch?.createdAt ?? new Date('2026-09-16T11:23:20.000Z');
  const start = new Date(around.getTime() - 180 * 1000);
  const end = new Date(around.getTime() + 180 * 1000);

  const [syncLogs, nearbyBatches, auditLogs] = await Promise.all([
    prisma.documentSyncLog
      .findMany({
        where: { createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: 'asc' },
        take: 20
      })
      .catch(() => []),
    prisma.dataBatch.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
      take: 30,
      select: {
        id: true,
        batchNo: true,
        status: true,
        totalCount: true,
        validCount: true,
        invalidCount: true,
        remark: true,
        importType: true,
        createdAt: true
      }
    }),
    (async () => {
      try {
        return await prisma.auditLog.findMany({
          where: { createdAt: { gte: start, lte: end } },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            userId: true,
            details: true,
            createdAt: true
          }
        });
      } catch {
        return [];
      }
    })()
  ]);

  const out = {
    batch,
    around: around.toISOString(),
    syncLogs,
    nearbyBatches,
    auditLogs
  };

  fs.writeFileSync('/tmp/batch-investigate-5.json', JSON.stringify(out, null, 2));
  process.stdout.write(
    'done ' +
      JSON.stringify({
        id: batch?.id ?? null,
        records: batch?.records?.length ?? 0
      }) +
      '\n'
  );
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
