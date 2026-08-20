import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/api-auth';

export async function GET() {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const stats = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { createdDataRecords: true, createdPushJobs: true } },
      roles: { include: { role: true } }
    }
  });

  return NextResponse.json({
    users: stats.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      roles: user.roles.map((item) => item.role.roleName),
      recordsCount: user._count.createdDataRecords,
      pushJobsCount: user._count.createdPushJobs
    }))
  });
}
