import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../api/endpoints';
import { clearToken, setToken, tokenStorage } from '../api/client';

export interface AuthUser { userId: string; nickname: string; roles: string[]; }

interface AuthCtx {
  user: AuthUser | null;
  /** internal=自有账号体系（登录/注册双 Tab）；external=dev-token UI（jwt/gateway 接入期兼容） */
  authMode: 'internal' | 'external';
  /** 嵌入模式（iframe）：隐藏顶栏/登录弹窗，postMessage 双通道 */
  isEmbed: boolean;
  login: (userId: string, nickname: string, roles: string[]) => Promise<void>;
  loginPassword: (username: string, password: string) => Promise<void>;
  registerAccount: (p: { username: string; password: string; nickname: string; role: string }) => Promise<void>;
  /** 嵌入 postMessage 通道注入 token：/me 拉身份，失败清 token */
  adoptToken: (token: string) => Promise<void>;
  logout: () => void;
  isHost: boolean;
  isAdmin: boolean;
}

const EMBED_KEY = 'live.embed';

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => tokenStorage.user);
  // config 拉取失败保持 external（原 dev-token UI），保证非 internal 部署形态与测试稳定
  const [authMode, setAuthMode] = useState<'internal' | 'external'>('external');
  // 嵌入标记：?embed=1 时落 localStorage，刷新/站内跳转后仍生效（useState 初始化仅执行一次）
  const [isEmbed] = useState<boolean>(() => {
    if (new URLSearchParams(window.location.search).get('embed') === '1') {
      localStorage.setItem(EMBED_KEY, '1');
    }
    return localStorage.getItem(EMBED_KEY) === '1';
  });
  // StrictMode 下 effect 双执行：URL 注入必须幂等（ref 守卫）
  const injectedRef = useRef(false);

  useEffect(() => {
    authApi.config()
      .then(c => { if (c.mode === 'internal') setAuthMode('internal'); })
      .catch(() => { /* 保持 external */ });
  }, []);

  // 嵌入模式：?token=<JWT> 注入登录态并从 URL 摘除，随后 /me 拉取身份；失败清 token
  useEffect(() => {
    if (injectedRef.current) return;
    injectedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (!urlToken) return;
    setToken(urlToken);
    params.delete('token');
    params.delete('embed');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    authApi.me()
      .then(me => { tokenStorage.user = me; setUser(me); })
      .catch(() => { clearToken(); tokenStorage.user = null; });
  }, []);

  const value = useMemo<AuthCtx>(() => {
    function adoptSession(token: string, u: AuthUser) {
      setToken(token);
      tokenStorage.user = u;
      setUser(u);
      // 正常登录（非嵌入）清除嵌入残留标记，避免顶栏/登录弹窗被错误隐藏
      localStorage.removeItem(EMBED_KEY);
    }
    return {
      user,
      authMode,
      isEmbed,
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
      async adoptToken(token) {
        setToken(token);
        try {
          const me = await authApi.me();
          tokenStorage.user = me;
          setUser(me);
        } catch (e) {
          clearToken();
          tokenStorage.user = null;
          setUser(null);
          throw e;
        }
      },
      logout() {
        clearToken();
        tokenStorage.user = null;
        setUser(null);
        localStorage.removeItem(EMBED_KEY);
      }
    };
  }, [user, authMode, isEmbed]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx { return useContext(Ctx); }
