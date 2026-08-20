import jwt from 'jsonwebtoken';
import { env } from '@/lib/env';

export const AUTH_COOKIE_NAME = 'sync_push_token';

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  roles?: string[];
  sessionId: string;
};

export function signAuthToken(user: AuthUser) {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as AuthUser & jwt.JwtPayload;
}
