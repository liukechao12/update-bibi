import 'dotenv/config';
import bcrypt from 'bcryptjs';
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

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  const user = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash },
    create: {
      username: 'admin',
      passwordHash,
      displayName: '系统管理员',
      department: '平台组',
      status: 'ACTIVE'
    }
  });

  const roles = [
    { roleCode: 'SUPER_ADMIN', roleName: '超级管理员' },
    { roleCode: 'OPERATOR', roleName: '运维管理员' },
    { roleCode: 'USER', roleName: '普通用户' }
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { roleCode: role.roleCode },
      update: { roleName: role.roleName },
      create: role
    });
  }

  const permissions = [
    { permCode: 'DATA_IMPORT', permName: '数据导入', moduleName: '数据录入' },
    { permCode: 'DATA_VIEW', permName: '数据查看', moduleName: '数据管理' },
    { permCode: 'DATA_PUSH', permName: '数据推送', moduleName: '推送中心' },
    { permCode: 'USER_MANAGE', permName: '人员管理', moduleName: '系统管理' },
    { permCode: 'CONFIG_MANAGE', permName: '系统配置', moduleName: '系统管理' }
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { permCode: permission.permCode },
      update: { permName: permission.permName, moduleName: permission.moduleName },
      create: permission
    });
  }

  const superAdminRole = await prisma.role.findUnique({ where: { roleCode: 'SUPER_ADMIN' } });
  const permissionsList = await prisma.permission.findMany();

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: user.id, roleId: superAdminRole.id }
    });

    for (const permission of permissionsList) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: superAdminRole.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: superAdminRole.id,
          permissionId: permission.id
        }
      });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
