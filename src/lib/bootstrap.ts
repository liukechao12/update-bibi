import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export async function bootstrapBaseData() {
  const adminRole = await prisma.role.upsert({
    where: { roleCode: 'SUPER_ADMIN' },
    update: {},
    create: {
      roleCode: 'SUPER_ADMIN',
      roleName: '超级管理员',
      description: '系统最高权限'
    }
  });

  const adminPermission = await prisma.permission.upsert({
    where: { permCode: 'SYSTEM_ALL' },
    update: {},
    create: {
      permCode: 'SYSTEM_ALL',
      permName: '系统全部权限',
      moduleName: 'SYSTEM'
    }
  });

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: adminRole.id,
        permissionId: adminPermission.id
      }
    },
    update: {},
    create: {
      roleId: adminRole.id,
      permissionId: adminPermission.id
    }
  });

  const passwordHash = await bcrypt.hash('admin123456', 10);
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash,
      displayName: '系统管理员',
      department: '平台组'
    }
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id
      }
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id
    }
  });
}
