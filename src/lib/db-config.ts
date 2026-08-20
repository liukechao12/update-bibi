export type MysqlConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export function parseMysqlDatabaseUrl(databaseUrl: string): MysqlConnectionConfig {
  const url = new URL(databaseUrl);

  if (url.protocol !== 'mysql:') {
    throw new Error(`Unsupported database protocol: ${url.protocol}`);
  }

  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL must include a database name');
  }

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database
  };
}
