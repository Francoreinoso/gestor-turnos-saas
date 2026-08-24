import type { AuthPayload } from '../domain/types';

export function parseToken(token: string): AuthPayload | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as AuthPayload & { exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function roleHome(role: string): string {
  return role === 'owner' ? '/owner/agenda' : '/staff/agenda';
}
