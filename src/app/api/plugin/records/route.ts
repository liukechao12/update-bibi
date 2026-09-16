import { NextResponse } from 'next/server';
import { POST as processRecords } from '@/app/api/records/route';
import { requireExternalApiClient, logExternalApiRequest } from '@/lib/external-api';
import { pushExistingRecords } from '@/lib/push-workflow';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': process.env.PLUGIN_CORS_ORIGIN || '*'
};

function withCors(response: NextResponse | undefined) {
  const result = response ?? NextResponse.json({ code: 50000, message: '服务器未返回响应' }, { status: 500 });
  Object.entries(corsHeaders).forEach(([key, value]) => result.headers.set(key, value));
  return result;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const auth = await requireExternalApiClient(request);
  if ('error' in auth) return withCors(auth.error);
  if (!auth.client.clientCode.startsWith('plugin_')) {
    return withCors(NextResponse.json({ code: 40301, message: '该 API Key 不是插件凭证' }, { status: 403 }));
  }

  const body = await request.clone().json().catch(() => ({}));
  const response = (await processRecords(request)) ?? NextResponse.json({ code: 50000, message: '服务器未返回响应' }, { status: 500 });
  if (response.ok && body?.autoPush !== false) {
    const payload = await response.clone().json().catch(() => ({}));
    const recordIds = Array.isArray(payload?.savedRecordIds) ? payload.savedRecordIds.filter((id: unknown): id is string => typeof id === 'string') : [];
    if (recordIds.length > 0) {
      try {
        const pushResult = await pushExistingRecords(auth.client.createdById, recordIds);
        const result = { ...payload, pushed: pushResult.results.reduce((sum, item) => sum + item.inserted, 0), pushFailed: pushResult.results.reduce((sum, item) => sum + item.failed, 0), pushResult };
        const pushedResponse = NextResponse.json(result, { status: response.status });
        void logExternalApiRequest({
          clientId: auth.client.id,
          path: '/api/plugin/records',
          method: 'POST',
          requestIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')?.trim() ?? null,
          responseCode: pushedResponse.status,
          responseCount: recordIds.length,
          costMs: Date.now() - startedAt
        });
        return withCors(pushedResponse);
      } catch (error) {
        const failedResponse = NextResponse.json({ ...payload, pushed: 0, pushFailed: recordIds.length, pushError: error instanceof Error ? error.message : '推送失败' }, { status: 502 });
        return withCors(failedResponse);
      }
    }
  }
  void logExternalApiRequest({
    clientId: auth.client.id,
    path: '/api/plugin/records',
    method: 'POST',
    requestIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')?.trim() ?? null,
    responseCode: response.status,
    costMs: Date.now() - startedAt
  });
  return withCors(response);
}
