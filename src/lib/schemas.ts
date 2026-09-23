import { z } from 'zod';
import { normalizeContentUrl, normalizePublishTimeToDate } from './mapping';

export const originTypeSchema = z.enum(['media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other']);
export const publisherTypeSchema = z.enum(['MEDIA', 'SOCIAL']);
export const authorTypeSchema = z.enum(['BLUE_V', 'SELF_MEDIA', 'PERSONAL']).nullable();

// 客户 v3 接口要求小写枚举（media/social、blue_v/self_media/personal），
// 这里定义推送给客户前的校验 schema 与转换函数。
// 仅允许 http/https，防止 javascript: 等协议造成存储型 XSS
export const httpUrlSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), '链接必须以 http:// 或 https:// 开头');

const cleanTextField = z.string().trim().min(1).refine((value) => !value.includes('[object Object]'), '字段包含非法对象序列化内容');
const publishTimeSchema = z.string().min(1).refine((value) => {
  const time = normalizePublishTimeToDate(value).getTime();
  return Number.isFinite(time) && time <= Date.now();
}, '发布时间无效或晚于当前时间');
const crawlTimeSchema = z.string().datetime({ offset: true }).refine((value) => new Date(value).getTime() <= Date.now(), '抓取时间不能晚于当前时间');

export const vendorPublisherTypeSchema = z.enum(['media', 'social']);
export const vendorAuthorTypeSchema = z.enum(['blue_v', 'self_media', 'personal']).nullable();

export const vendorPushRecordSchema = z.object({
  textId: z.string().min(1),
  title: cleanTextField,
  text: cleanTextField,
  publishTime: publishTimeSchema,
  crawlTime: crawlTimeSchema.optional(),
  author: cleanTextField,
  originType: originTypeSchema,
  publisherType: vendorPublisherTypeSchema,
  authorType: vendorAuthorTypeSchema,
  url: httpUrlSchema,
  // 客户接口要求评论数必填；即使上游未采集，也必须明确传 0，不能传 null。
  commentNum: z.number().int().nonnegative(),
  forwardNum: z.number().int().nonnegative().nullable(),
  praiseNum: z.number().int().nonnegative().nullable(),
  viewNum: z.number().int().nonnegative().nullable()
}).refine((record) => !record.crawlTime || normalizePublishTimeToDate(record.publishTime).getTime() <= new Date(record.crawlTime).getTime(), {
  message: '发布时间不能晚于抓取时间',
  path: ['publishTime']
});

export const vendorPushRequestSchema = z.object({
  version: z.string().default('3').optional(),
  records: z.array(vendorPushRecordSchema).min(1).max(100)
});

export type VendorPushRequestInput = z.infer<typeof vendorPushRequestSchema>;
export type VendorPushRecordInput = z.infer<typeof vendorPushRecordSchema>;

export function publisherTypeToVendor(value: 'MEDIA' | 'SOCIAL'): 'media' | 'social' {
  return value === 'MEDIA' ? 'media' : 'social';
}

export function authorTypeToVendor(value: 'BLUE_V' | 'SELF_MEDIA' | 'PERSONAL' | null): 'blue_v' | 'self_media' | 'personal' | null {
  switch (value) {
    case 'BLUE_V':
      return 'blue_v';
    case 'SELF_MEDIA':
      return 'self_media';
    case 'PERSONAL':
      return 'personal';
    default:
      return null;
  }
}

export const pushRecordSchema = z.object({
  textId: z.string().min(1),
  title: cleanTextField,
  text: cleanTextField,
  publishTime: publishTimeSchema,
  crawlTime: crawlTimeSchema.optional(),
  author: cleanTextField,
  originType: originTypeSchema,
  publisherType: publisherTypeSchema,
  authorType: authorTypeSchema,
  url: httpUrlSchema.transform(normalizeContentUrl),
  commentNum: z.number().int().nonnegative(),
  forwardNum: z.number().int().nonnegative().nullable(),
  praiseNum: z.number().int().nonnegative().nullable(),
  viewNum: z.number().int().nonnegative().nullable()
}).refine((record) => !record.crawlTime || normalizePublishTimeToDate(record.publishTime).getTime() <= new Date(record.crawlTime).getTime(), {
  message: '发布时间不能晚于抓取时间',
  path: ['publishTime']
});

export const pushRequestSchema = z.object({
  version: z.string().default('3').optional(),
  records: z.array(pushRecordSchema).min(1).max(100)
});

// 内部粘贴/接口入库用：不限制 100 条，单条仍按 pushRecordSchema 逐条校验
export const pushRecordsSaveSchema = z.object({
  version: z.string().default('3').optional(),
  records: z.array(pushRecordSchema).min(1).max(500)
});

export type PushRequestInput = z.infer<typeof pushRequestSchema>;
export type PushRecordInput = z.infer<typeof pushRecordSchema>;
