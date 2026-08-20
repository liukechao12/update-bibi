import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user!;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.roles?.includes('SUPER_ADMIN')) {
    redirect('/');
  }
  return user;
}
