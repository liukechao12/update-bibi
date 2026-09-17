import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/api-auth';
import { getEventCategoryOptions } from '@/lib/event-categories';
import { generateApiKey, hashApiKey } from '@/lib/external-api';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const clientName = typeof body?.clientName === 'string' ? body.clientName.trim() : undefined;
  const status = typeof body?.status === 'string' ? body.status.trim() : undefined;
  const allowAllEvents = typeof body?.allowAllEvents === 'boolean' ? body.allowAllEvents : undefined;
  const rateLimitPerMinute = body?.rateLimitPerMinute === undefined ? undefined : Math.max(1, Number(body.rateLimitPerMinute) || 60);
  const expiresAtRaw = body?.expiresAt === undefined ? undefined : String(body.expiresAt ?? '').trim();
  const eventCategories = Array.isArray(body?.eventCategories)
    ? body.eventCategories.map((item: unknown) => String(item).trim()).filter(Boolean)
    : undefined;

  if (status && !['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ code: 40003, message: '状态不合法' }, { status: 400 });
  }

  if (eventCategories) {
    const validCategories = new Set((await getEventCategoryOptions()).map((item) => item.value));
    const invalidCategory = eventCategories.find((item: string) => !validCategories.has(item));
    if (invalidCategory) {
      return NextResponse.json({ code: 40003, message: `事件项目不合法：${invalidCategory}` }, { status: 400 });
    }
  }

  const current = await prisma.externalApiClient.findUnique({ where: { id }, include: { eventScopes: true } });
  if (!current) {
    return NextResponse.json({ code: 40400, message: '客户不存在' }, { status: 404 });
  }

  const nextAllowAll = allowAllEvents ?? current.allowAllEvents;
  const nextCategories = eventCategories ?? current.eventScopes.map((item) => item.eventCategory);
  if (!nextAllowAll && nextCategories.length === 0) {
    return NextResponse.json({ code: 40002, message: '请至少选择一个授权事件项目' }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.externalApiClient.update({
      where: { id },
      data: {
        ...(clientName !== undefined ? { clientName } : {}),
        ...(status !== undefined ? { status: status as never } : {}),
        ...(allowAllEvents !== undefined ? { allowAllEvents } : {}),
        ...(rateLimitPerMinute !== undefined ? { rateLimitPerMinute } : {}),
        ...(expiresAtRaw !== undefined ? { expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null } : {})
      }
    });

    if (eventCategories || allowAllEvents !== undefined) {
      await tx.externalApiClientEventScope.deleteMany({ where: { clientId: id } });
      if (!nextAllowAll) {
        await tx.externalApiClientEventScope.createMany({
          data: nextCategories.map((eventCategory: string) => ({ clientId: id, eventCategory }))
        });
      }
    }

    return tx.externalApiClient.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        eventScopes: true,
        _count: { select: { requestLogs: true } }
      }
    });
  });

  return NextResponse.json({ ok: true, client: updated });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const client = await prisma.externalApiClient.findUnique({ where: { id } });
  if (!client) {
    return NextResponse.json({ code: 40400, message: '客户不存在' }, { status: 404 });
  }

  const apiKey = generateApiKey();
  await prisma.externalApiClient.update({
    where: { id },
    data: { apiKeyHash: hashApiKey(apiKey) }
  });

  return NextResponse.json({ ok: true, apiKey });
}
