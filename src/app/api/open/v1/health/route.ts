import { buildApiResponse, requireExternalApiClient } from '@/lib/external-api';

export async function GET(request: Request) {
  const auth = await requireExternalApiClient(request);
  if ('error' in auth) return auth.error;

  return buildApiResponse({
    status: 'ok',
    clientCode: auth.client.clientCode,
    clientName: auth.client.clientName,
    allowAllEvents: auth.client.allowAllEvents,
    rateLimitPerMinute: auth.client.rateLimitPerMinute,
    expiresAt: auth.client.expiresAt
  });
}
