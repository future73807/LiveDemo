import { createContext, useContext, useMemo, useState } from 'react';
import { authApi } from '../api/endpoints';
import { clearToken, setToken, tokenStorage } from '../api/client';

export interface AuthUser { userId: string; nickname: string; roles: string[]; }

interface AuthCtx {
  user: AuthUser | null;
  login: (userId: string, nickname: string, roles: string[]) => Promise<void>;
  logout: () => void;
  isHost: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => tokenStorage.user);

  const value = useMemo<AuthCtx>(() => ({
    user,
    isHost: !!user?.roles.includes('HOST'),
    isAdmin: !!user?.roles.includes('ADMIN'),
    async login(userId, nickname, roles) {
      const { token } = await authApi.devToken(userId, nickname, roles);
      setToken(token);
      const u = { userId, nickname, roles };
      tokenStorage.user = u;
      setUser(u);
    },
    logout() {
      clearToken();
      tokenStorage.user = null;
      setUser(null);
    }
  }), [user]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx { return useContext(Ctx); }
