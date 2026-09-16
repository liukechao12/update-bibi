import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';
import { parseMysqlDatabaseUrl } from '@/lib/db-config';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const config = parseMysqlDatabaseUrl(env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  ...config,
  connectionLimit: 20,
  connectTimeout: 5_000
});

export const prisma = global.prisma ?? new PrismaClient({
  adapter,
  log: ['warn', 'error']
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
