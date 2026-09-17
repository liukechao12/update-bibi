import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEventCategoryOptions } from '@/lib/event-categories';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const RATE_LIMIT_WINDOW_MS = 60_000;

type AuthResult =
  | { client: { id: string; clientCode: string; clientName: string; department: string | null; status: 'ACTIVE' | 'DISABLED'; allowAllEvents: boolean; rateLimitPerMinute: number; expiresAt: Date | null; lastUsedAt: Date | null; createdById: string }; error?: never }
  | { error: NextResponse };

export function hashApiKey(apiKey: string) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey() {
  return `ea_${crypto.randomBytes(24).toString('hex')}`;
}

export function normalizeExternalPageSize(value?: string | null) {
  if (!value) return DEFAULT_PAGE_SIZE;
  if (value === 'all') return MAX_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(parsed)));
}

export async function allowedCategories(client: { allowAllEvents: boolean; eventScopes: Array<{ eventCategory: string }> }) {
  if (client.allowAllEvents) return (await getEventCategoryOptions()).map((item) => item.value);
  return client.eventScopes.map((item) => item.eventCategory);
}

export async function requireExternalApiClient(request: Request): Promise<AuthResult> {
  const apiKey = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || request.headers.get('x-api-key')?.trim() || '';
  if (!apiKey) {
    return { error: NextResponse.json({ code: 40100, message: '缺少 API Key' }, { status: 401 }) };
  }

  const apiKeyHash = hashApiKey(apiKey);
  const client = await prisma.externalApiClient.findUnique({
    where: { apiKeyHash },
    include: { eventScopes: true }
  });

  if (!client) {
    return { error: NextResponse.json({ code: 40101, message: 'API Key 无效' }, { status: 401 }) };
  }

  if (client.status === 'DISABLED') {
    return { error: NextResponse.json({ code: 40301, message: '客户凭证已禁用' }, { status: 403 }) };
  }

  if (client.expiresAt && client.expiresAt.getTime() < Date.now()) {
    return { error: NextResponse.json({ code: 40302, message: '客户凭证已过期' }, { status: 403 }) };
  }

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || null;
  const recentCount = await prisma.externalApiRequestLog.count({
    where: {
      clientId: client.id,
      createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) }
    }
  });

  if (recentCount >= client.rateLimitPerMinute) {
    return { error: NextResponse.json({ code: 42900, message: '请求过于频繁' }, { status: 429 }) };
  }

  await prisma.externalApiClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
  if (clientIp) {
    void clientIp;
  }

  return {
    client: {
      id: client.id,
      clientCode: client.clientCode,
      clientName: client.clientName,
      department: client.department ?? null,
      status: client.status,
      allowAllEvents: client.allowAllEvents,
      rateLimitPerMinute: client.rateLimitPerMinute,
      expiresAt: client.expiresAt,
      lastUsedAt: client.lastUsedAt,
      createdById: client.createdById
    }
  };
}

export async function verifyEventAccess(clientId: string, category: string) {
  const client = await prisma.externalApiClient.findUnique({
    where: { id: clientId },
    include: { eventScopes: true }
  });
  if (!client) return false;
  if (client.allowAllEvents) return true;
  return client.eventScopes.some((item) => item.eventCategory === category);
}

export async function logExternalApiRequest(input: {
  clientId: string;
  path: string;
  method: string;
  requestIp?: string | null;
  requestQuery?: unknown;
  responseCode: number;
  responseCount?: number;
  costMs?: number;
}) {
  await prisma.externalApiRequestLog.create({
    data: {
      clientId: input.clientId,
      path: input.path,
      method: input.method,
      requestIp: input.requestIp ?? null,
      requestQuery: input.requestQuery as never,
      responseCode: input.responseCode,
      responseCount: input.responseCount ?? 0,
      costMs: input.costMs ?? 0
    }
  });
}

export function buildApiResponse(data: unknown, meta?: Record<string, unknown>) {
  return NextResponse.json({ code: 0, message: 'ok', ...meta, data });
}
