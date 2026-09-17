import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/api-auth';
import { getEventCategoryOptions } from '@/lib/event-categories';
import { generateApiKey, hashApiKey } from '@/lib/external-api';

export async function GET() {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const clients = await prisma.externalApiClient.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, displayName: true, username: true } },
      eventScopes: true,
      _count: { select: { requestLogs: true } }
    }
  });

  return NextResponse.json({
    clients,
    eventCategories: await getEventCategoryOptions()
  });
}

export async function POST(request: Request) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const clientCode = String(body?.clientCode ?? '').trim();
  const clientName = String(body?.clientName ?? '').trim();
  const allowAllEvents = Boolean(body?.allowAllEvents);
  const rateLimitPerMinute = Math.max(1, Number(body?.rateLimitPerMinute ?? 60) || 60);
  const expiresAtRaw = String(body?.expiresAt ?? '').trim();
  const eventCategories = Array.isArray(body?.eventCategories)
    ? body.eventCategories.map((item: unknown) => String(item).trim()).filter(Boolean)
    : [];

  if (!clientCode || !clientName) {
    return NextResponse.json({ code: 40002, message: '客户编码和客户名称不能为空' }, { status: 400 });
  }

  if (!allowAllEvents && eventCategories.length === 0) {
    return NextResponse.json({ code: 40002, message: '请至少选择一个授权事件项目' }, { status: 400 });
  }

  const validCategories = new Set((await getEventCategoryOptions()).map((item) => item.value));
  const invalidCategory = eventCategories.find((item: string) => !validCategories.has(item));
  if (invalidCategory) {
    return NextResponse.json({ code: 40003, message: `事件项目不合法：${invalidCategory}` }, { status: 400 });
  }

  const existed = await prisma.externalApiClient.findUnique({ where: { clientCode } });
  if (existed) {
    return NextResponse.json({ code: 40009, message: '客户编码已存在' }, { status: 400 });
  }

  const apiKey = generateApiKey();
  const created = await prisma.externalApiClient.create({
    data: {
      clientCode,
      clientName,
      apiKeyHash: hashApiKey(apiKey),
      status: 'ACTIVE',
      allowAllEvents,
      rateLimitPerMinute,
      expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
      createdById: auth.user.id,
      ...(allowAllEvents
        ? {}
        : {
            eventScopes: {
              create: eventCategories.map((eventCategory: string) => ({ eventCategory }))
            }
          })
    },
    include: {
      createdBy: { select: { id: true, displayName: true, username: true } },
      eventScopes: true,
      _count: { select: { requestLogs: true } }
    }
  });

  return NextResponse.json({ ok: true, client: created, apiKey });
}
