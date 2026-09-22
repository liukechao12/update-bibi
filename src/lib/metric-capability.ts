import { prisma } from '@/lib/prisma';

export type MetricCapability = {
  commentCollectable: boolean;
  forwardCollectable: boolean;
  praiseCollectable: boolean;
};

export async function loadMetricCapabilityMap(): Promise<Map<string, MetricCapability>> {
  const rows = await prisma.mediaMetricCapability.findMany({
    select: {
      sourceName: true,
      commentCollectable: true,
      forwardCollectable: true,
      praiseCollectable: true
    }
  });
  return new Map(rows.map((row) => [
    row.sourceName.trim(),
    {
      commentCollectable: row.commentCollectable,
      forwardCollectable: row.forwardCollectable,
      praiseCollectable: row.praiseCollectable
    }
  ]));
}

// collectable === undefined 表示媒体不在能力表内：默认 null，仅非 0 读数保留具体值
export function resolveMetricValue(read: number | null, collectable: boolean | undefined): number | null {
  if (collectable === true) return read;
  if (collectable === false) return null;
  return read !== null && read !== 0 ? read : null;
}

// 评论数是客户接口必填字段：无论媒体采集能力如何，始终保留实际数字，空值由出站层补为 0。
// 转发和点赞仍按采集能力处理：未采集或不适用传 null。
export function applyMetricCapability<T extends { commentNum: number | null; forwardNum: number | null; praiseNum: number | null }>(
  record: T,
  sourceName: string | null,
  capabilityMap: Map<string, MetricCapability>
): T {
  const capability = sourceName ? capabilityMap.get(sourceName.trim()) : undefined;
  return {
    ...record,
    commentNum: record.commentNum ?? 0,
    forwardNum: resolveMetricValue(record.forwardNum, capability?.forwardCollectable),
    praiseNum: resolveMetricValue(record.praiseNum, capability?.praiseCollectable)
  };
}
