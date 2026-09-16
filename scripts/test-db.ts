import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

async function main() {
  const url = process.env.DATABASE_URL!;
  const m = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error('cannot parse url');
  const [, user, password, host, port, database] = m;
  const config = { user, password, host, port: Number(port), database: database.split('?')[0] };
  const adapter = new PrismaMariaDb({ ...config, connectionLimit: 5, connectTimeout: 8000 });
  const prisma = new PrismaClient({ adapter, log: ['warn','error'] });
  const r = await prisma.$queryRawUnsafe('SELECT 1 as ok');
  console.log('QUERY OK:', JSON.stringify(r));
  const tables = await prisma.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name") as Array<{ TABLE_NAME: string }>;
  console.log('TABLES:', tables.map((t)=>t.TABLE_NAME).join(', '));
  await prisma.$disconnect();
}
main().catch((e)=>{ console.error('FAILED:', e.message); process.exit(1); });