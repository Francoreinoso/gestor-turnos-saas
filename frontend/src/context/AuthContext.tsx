import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthPayload } from '../domain/types';
import { parseToken } from '../utils/token';

function initFromStorage(): { token: string | null; user: AuthPayload | null } {
  const raw = localStorage.getItem('token');
  if (!raw) return { token: null, user: null };
  const user = parseToken(raw);
  if (!user) {
    localStorage.removeItem('token');
    return { token: null, user: null };
  }
  return { token: raw, user };
}

interface AuthContextValue {
  token: string | null;
  user: AuthPayload | null;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const init = initFromStorage();
  const [token, setToken] = useState<string | null>(init.token);
  const [user, setUser]   = useState<AuthPayload | null>(init.user);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  const login = useCallback((newToken: string) => {
    const payload = parseToken(newToken);
    if (!payload) return;
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(payload);
  }, []);

  useEffect(() => {
    window.addEventListener('auth:logout', logout);
    return () => window.removeEventListener('auth:logout', logout);
  }, [logout]);

  return <AuthContext.Provider value={{ token, user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
