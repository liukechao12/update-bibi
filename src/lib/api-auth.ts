import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { hashApiKey } from '@/lib/external-api';

export async function requireApiUser(request?: Request) {
  const bearer = request?.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (bearer) {
    const client = await prisma.externalApiClient.findUnique({ where: { apiKeyHash: hashApiKey(bearer) } });
    if (client?.clientCode.startsWith('plugin_') && client.status === 'ACTIVE' && (!client.expiresAt || client.expiresAt.getTime() >= Date.now())) {
      const user = await prisma.user.findUnique({
        where: { id: client.createdById },
        include: { roles: { include: { role: true } } }
      });
      if (user) return {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          department: user.department,
          accountType: user.accountType,
          roles: user.roles.map((item) => item.role.roleCode),
          sessionId: user.currentSessionId
        }
      };
    }
  }
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ code: 40100, message: '未登录' }, { status: 401 }) };
  }
  return { user };
}

export async function requireApiAdmin() {
  const result = await requireApiUser();
  if ('error' in result) return result;
  if (!result.user.roles?.includes('SUPER_ADMIN')) {
    return { error: NextResponse.json({ code: 40301, message: '无权限' }, { status: 403 }) };
  }
  return result;
}
