function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

function formatTimestamp(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    pad(date.getMilliseconds(), 3)
  ].join('');
}

export function generateBusinessNo(prefix: string) {
  const timestamp = formatTimestamp(new Date());
  // 时间戳保留可读性，随机后缀保证并发创建时不会撞唯一键。
  const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${prefix}-${timestamp}-${randomSuffix}`;
}

export function generateBatchNo(prefix = 'BATCH') {
  return generateBusinessNo(prefix);
}

export function generateJobNo(prefix = 'JOB') {
  return generateBusinessNo(prefix);
}
