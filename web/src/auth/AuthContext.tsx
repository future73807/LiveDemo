import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/endpoints';
import { clearToken, setToken, tokenStorage } from '../api/client';

export interface AuthUser { userId: string; nickname: string; roles: string[]; }

interface AuthCtx {
  user: AuthUser | null;
  /** internal=自有账号体系（登录/注册双 Tab）；external=dev-token UI（jwt/gateway 接入期兼容） */
  authMode: 'internal' | 'external';
  login: (userId: string, nickname: string, roles: string[]) => Promise<void>;
  loginPassword: (username: string, password: string) => Promise<void>;
  registerAccount: (p: { username: string; password: string; nickname: string; role: string }) => Promise<void>;
  logout: () => void;
  isHost: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => tokenStorage.user);
  // config 拉取失败保持 external（原 dev-token UI），保证非 internal 部署形态与测试稳定
  const [authMode, setAuthMode] = useState<'internal' | 'external'>('external');

  useEffect(() => {
    authApi.config()
      .then(c => { if (c.mode === 'internal') setAuthMode('internal'); })
      .catch(() => { /* 保持 external */ });
  }, []);

  const value = useMemo<AuthCtx>(() => {
    function adoptSession(token: string, u: AuthUser) {
      setToken(token);
      tokenStorage.user = u;
      setUser(u);
    }
    return {
      user,
      authMode,
      isHost: !!user?.roles.includes('HOST'),
      isAdmin: !!user?.roles.includes('ADMIN'),
      async login(userId, nickname, roles) {
        const { token } = await authApi.devToken(userId, nickname, roles);
        adoptSession(token, { userId, nickname, roles });
      },
      async loginPassword(username, password) {
        const { token, user: u } = await authApi.login(username, password);
        adoptSession(token, u);
      },
      async registerAccount(p) {
        const { token, user: u } = await authApi.register(p);
        adoptSession(token, u);
      },
      logout() {
        clearToken();
        tokenStorage.user = null;
        setUser(null);
      }
    };
  }, [user, authMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx { return useContext(Ctx); }
