import { z } from 'zod';

export const originTypeSchema = z.enum(['media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other']);
export const publisherTypeSchema = z.enum(['MEDIA', 'SOCIAL']);
export const authorTypeSchema = z.enum(['BLUE_V', 'SELF_MEDIA', 'PERSONAL']).nullable();

export const pushRecordSchema = z.object({
  textId: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  publishTime: z.string().min(1),
  author: z.string().min(1),
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
  version: z.string().default('1').optional(),
  records: z.array(pushRecordSchema).min(1).max(100)
});

export type PushRequestInput = z.infer<typeof pushRequestSchema>;
export type PushRecordInput = z.infer<typeof pushRecordSchema>;
