import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import UserList from './user-list';

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ keyword?: string; status?: string; role?: string }> }) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;

  const keyword = resolvedSearchParams.keyword?.trim() ?? '';
  const status = resolvedSearchParams.status ?? '';
  const roleCode = resolvedSearchParams.role ?? '';

  const where: import('@prisma/client').Prisma.UserWhereInput = {};

  if (keyword) {
    where.OR = [
      { username: { contains: keyword } },
      { displayName: { contains: keyword } },
      { department: { contains: keyword } }
    ];
  }
  if (status === 'ACTIVE' || status === 'DISABLED') {
    where.status = status;
  }
  if (roleCode) {
    where.roles = { some: { role: { roleCode } } };
  }

  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        roles: { include: { role: true } },
        _count: { select: { createdDataRecords: true, createdPushJobs: true } }
      }
    }),
    prisma.role.findMany({ orderBy: { roleCode: 'asc' } })
  ]);

  const serializedUsers = users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    department: user.department ?? '',
    status: user.status,
    roles: user.roles.map((item) => item.role.roleCode),
    roleNames: user.roles.map((item) => item.role.roleName),
    recordsCount: user._count.createdDataRecords,
    pushJobsCount: user._count.createdPushJobs,
    createdAt: formatBeijingTime(user.createdAt)
  }));

  const serializedRoles = roles.map((role) => ({
    roleCode: role.roleCode,
    roleName: role.roleName
  }));

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">人员管理</span>
          <h1>用户、部门与角色管理</h1>
          <p>管理员可以新增用户、关闭用户，并查看每个用户的上传/推送统计。</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <UserList users={serializedUsers} roles={serializedRoles} keyword={keyword} status={status} roleCode={roleCode} />
    </main>
  );
}
