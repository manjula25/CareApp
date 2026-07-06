import { createContext, type ReactNode, useContext, useMemo, useState, useCallback } from 'react';
import { login as apiLogin } from '../api/client';

export type Role = 'director' | 'coordinator' | 'social_worker';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const TOKEN_KEY = 'caresync_token';

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeUser(token: string): AuthUser | null {
  try {
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64));
    if (!payload.id || !payload.role) return null;
    return { id: payload.id, name: payload.name, role: payload.role };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));

  const login = useCallback(async (email: string, password: string) => {
    const { token: newToken } = await apiLogin(email, password);
    const user = decodeUser(newToken);
    if (!user) throw new Error('Received an unreadable token');
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    return user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  const user = useMemo(() => (token ? decodeUser(token) : null), [token]);

  const value = useMemo(() => ({ user, token, login, logout }), [user, token, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export function roleHome(role: Role): string {
  if (role === 'director') return '/population';
  if (role === 'coordinator') return '/panel';
  // S7 B1 — the Social Worker's mobile task queue (M02) now exists;
  // '/coming-soon' was always a placeholder for this exact screen.
  return '/tasks';
}
