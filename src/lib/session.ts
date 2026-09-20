import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function getCurrentUser() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const payload = verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { roles: { include: { role: true } } }
    });

    if (!user) return null;
    if (user.status !== 'ACTIVE') return null;
    if (user.currentSessionId && user.currentSessionId !== payload.sessionId) return null;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      department: user.department,
      accountType: user.accountType,
      roles: user.roles.map((item) => item.role.roleCode),
      sessionId: payload.sessionId
    };
  } catch {
    return null;
  }
}
