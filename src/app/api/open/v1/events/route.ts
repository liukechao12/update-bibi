import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEventCategoryOptions } from '@/lib/event-categories';
import { buildApiResponse, logExternalApiRequest, requireExternalApiClient } from '@/lib/external-api';

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireExternalApiClient(request);
  if ('error' in auth) return auth.error;

  const client = auth.client;
  const options = await getEventCategoryOptions();
  const allowed = client.allowAllEvents ? options.map((item) => item.value) : (await prisma.externalApiClientEventScope.findMany({ where: { clientId: client.id }, select: { eventCategory: true } })).map((item) => item.eventCategory);
  const categories = options.filter((item) => allowed.includes(item.value));

  const response = buildApiResponse({ categories, allowAllEvents: client.allowAllEvents, rateLimitPerMinute: client.rateLimitPerMinute, expiresAt: client.expiresAt });
  await logExternalApiRequest({
    clientId: client.id,
    path: '/api/open/v1/events',
    method: 'GET',
    requestIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')?.trim() ?? null,
    requestQuery: Object.fromEntries(new URL(request.url).searchParams.entries()),
    responseCode: 200,
    responseCount: categories.length,
    costMs: Date.now() - startedAt
  });
  return response;
}
