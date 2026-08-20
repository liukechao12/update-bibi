import crypto from 'crypto';
import { OriginType, ParsedRawRecord, PushRecord, PublisherType, AuthorType } from '@/lib/types';

const originTypeMap: Record<string, OriginType> = {
  微博: 'wb',
  新浪微博: 'wb',
  微博热搜: 'wb',
  微信: 'wx',
  公众号: 'wx',
  视频号: 'sph',
  小红书: 'xhs',
  抖音: 'dy',
  知乎: 'zh',
  贴吧: 'tb',
  网站: 'media',
  新闻: 'media',
  媒体: 'media',
  其他: 'other',
  App: 'other',
  自媒体: 'other'
};

const publisherTypeMap: Record<string, PublisherType> = {
  媒体: 'MEDIA',
  官方: 'MEDIA',
  认证: 'MEDIA',
  新闻: 'MEDIA',
  微博: 'SOCIAL',
  微信: 'SOCIAL',
  小红书: 'SOCIAL',
  抖音: 'SOCIAL',
  知乎: 'SOCIAL',
  贴吧: 'SOCIAL',
  个人: 'SOCIAL',
  自媒体: 'SOCIAL'
};

const authorTypeMap: Record<string, AuthorType> = {
  蓝V: 'BLUE_V',
  蓝v: 'BLUE_V',
  认证媒体: 'BLUE_V',
  自媒体: 'SELF_MEDIA',
  媒体号: 'SELF_MEDIA',
  个人: 'PERSONAL',
  普通用户: 'PERSONAL'
};

export function normalizeOriginType(source?: string): OriginType {
  if (!source) return 'other';
  return originTypeMap[source.trim()] ?? 'other';
}

export function normalizePublisherType(source?: string, originType?: OriginType): PublisherType {
  if (originType === 'media') return 'MEDIA';
  if (!source) return 'SOCIAL';
  return publisherTypeMap[source.trim()] ?? 'SOCIAL';
}

export function normalizeAuthorType(source?: string, publisherType?: PublisherType, originType?: OriginType): AuthorType {
  if (originType === 'xhs') return 'PERSONAL';
  if (publisherType === 'MEDIA') return 'BLUE_V';
  if (!source) return null;
  return authorTypeMap[source.trim()] ?? 'PERSONAL';
}

export function normalizePublishTime(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Excel 读出的 Date toString 格式：Mon Jul 27 2026 08:24:00 GMT+0800 (China Standard Time)
  const jsDateMatch = value.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (jsDateMatch) {
    const monthMap: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    const month = monthMap[jsDateMatch[1]] ?? '01';
    return `${jsDateMatch[3]}-${month}-${jsDateMatch[2]} ${jsDateMatch[4]}:${jsDateMatch[5]}:${jsDateMatch[6]}`;
  }

  // ISO 格式：2026-07-27T08:24:00.000Z
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]} ${isoMatch[4]}:${isoMatch[5]}:${isoMatch[6]}`;
  }

  const normalized = value.replace(/[./]/g, '-').replace('年', '-').replace('月', '-').replace('日', '');
  if (normalized.includes(':') && normalized.length >= 16) {
    const parts = normalized.split(' ');
    if (parts.length === 2) {
      const datePart = parts[0].split('-').map((part) => part.padStart(2, '0')).join('-');
      return `${datePart} ${parts[1].slice(0, 8)}`;
    }
  }
  return normalized;
}

export function normalizePublishTimeToDate(value?: string): Date {
  const normalized = normalizePublishTime(value).replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

export function buildTextId(input: {
  source?: string;
  link?: string;
  title?: string;
  time?: string;
}): string {
  const normalized = {
    source: input.source ?? 'unknown',
    link: input.link ?? '',
    title: input.title ?? '',
    time: input.time ?? ''
  };
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 24);
  return `${normalizeOriginType(input.source).toUpperCase()}_${hash}`;
}

export function mapRawRecordToPushRecord(raw: ParsedRawRecord): PushRecord {
  const title = raw.title?.trim() || '未命名标题';
  const text = raw.summary?.trim() || title;
  const originType = normalizeOriginType(raw.source);
  const publisherType = normalizePublisherType(raw.source, originType);
  const authorType = normalizeAuthorType(raw.source, publisherType, originType);

  return {
    textId: buildTextId({ source: raw.source, link: raw.link, title, time: raw.time }),
    title,
    text,
    publishTime: normalizePublishTime(raw.time),
    author: raw.author?.trim() || '未知作者',
    originType,
    publisherType,
    authorType,
    url: raw.link?.trim() || '',
    commentNum: Number(raw.commentNum ?? 0),
    forwardNum: raw.forwardNum ?? null,
    praiseNum: raw.praiseNum ?? null,
    viewNum: raw.viewNum ?? null
  };
}

export function chunkRecords<T>(records: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }
  return chunks;
}
