import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const adapter = new PrismaMariaDb({
  host: '36.111.148.138',
  port: 3306,
  user: 'jiebao',
  password: 'Js8YPk6csKb2wdKG',
  database: 'jiebao',
  connectionLimit: 5,
  connectTimeout: 5_000
});

export const prisma = global.prisma ?? new PrismaClient({
  adapter,
  log: ['warn', 'error']
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
