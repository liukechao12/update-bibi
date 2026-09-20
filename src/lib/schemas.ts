import { z } from 'zod';

export const originTypeSchema = z.enum(['media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other']);
export const publisherTypeSchema = z.enum(['MEDIA', 'SOCIAL']);
export const authorTypeSchema = z.enum(['BLUE_V', 'SELF_MEDIA', 'PERSONAL']).nullable();

// 客户 v3 接口要求小写枚举（media/social、blue_v/self_media/personal），
// 这里定义推送给客户前的校验 schema 与转换函数。
const cleanTextField = z.string().min(1).refine((value) => !value.includes('[object Object]'), '字段包含非法对象序列化内容');

export const vendorPublisherTypeSchema = z.enum(['media', 'social']);
export const vendorAuthorTypeSchema = z.enum(['blue_v', 'self_media', 'personal']).nullable();

export const vendorPushRecordSchema = z.object({
  textId: z.string().min(1),
  title: cleanTextField,
  text: cleanTextField,
  publishTime: z.string().min(1),
  crawlTime: z.string().datetime({ offset: true }).optional(),
  author: cleanTextField,
  originType: originTypeSchema,
  publisherType: vendorPublisherTypeSchema,
  authorType: vendorAuthorTypeSchema,
  url: z.string().url(),
  // 客户确认：平台采集不到的互动指标推 null（媒体采集能力表判定）
  commentNum: z.number().int().nonnegative().nullable(),
  forwardNum: z.number().int().nonnegative().nullable(),
  praiseNum: z.number().int().nonnegative().nullable(),
  viewNum: z.number().int().nonnegative().nullable()
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
  publishTime: z.string().min(1),
  crawlTime: z.string().datetime({ offset: true }).optional(),
  author: cleanTextField,
  originType: originTypeSchema,
  publisherType: publisherTypeSchema,
  authorType: authorTypeSchema,
  url: z.string().url(),
  commentNum: z.number().int().nonnegative(),
  forwardNum: z.number().int().nonnegative().nullable(),
  praiseNum: z.number().int().nonnegative().nullable(),
  viewNum: z.number().int().nonnegative().nullable()
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
