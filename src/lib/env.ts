import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  VENDOR_API_BASE_URL: z.string().url(),
  VENDOR_API_TOKEN: z.string().min(1)
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  VENDOR_API_BASE_URL: process.env.VENDOR_API_BASE_URL,
  VENDOR_API_TOKEN: process.env.VENDOR_API_TOKEN
});
