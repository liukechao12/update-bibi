import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/api-auth';

export async function GET() {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      displayName: true,
      department: true,
      accountType: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      roles: { include: { role: true } },
      _count: { select: { createdDataRecords: true, createdPushJobs: true } }
    }
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  const displayName = String(body?.displayName ?? '').trim();
  const department = String(body?.department ?? '').trim();
  const roleCode = String(body?.roleCode ?? 'USER').trim();

  if (!username || !password || !displayName) {
    return NextResponse.json({ code: 40002, message: '用户名、密码、显示名称不能为空' }, { status: 400 });
  }

  const existed = await prisma.user.findUnique({ where: { username } });
  if (existed) {
    return NextResponse.json({ code: 40009, message: '用户名已存在' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      displayName,
      department: department || null,
      status: 'ACTIVE'
    }
  });

  const role = await prisma.role.findUnique({ where: { roleCode } });
  if (role) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  return NextResponse.json({ ok: true, userId: user.id });
}
