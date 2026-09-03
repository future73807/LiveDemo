const TOKEN_KEY = 'live.token';
const USER_KEY = 'live.user';

export function getToken(): string { return localStorage.getItem(TOKEN_KEY) ?? ''; }
export function setToken(token: string): void { localStorage.setItem(TOKEN_KEY, token); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(`/api${path}`, { ...init, headers });
  const body = await resp.json().catch(() => ({})) as { code?: string; message?: string; data?: T };
  if (!resp.ok) throw new ApiError(resp.status, body.message ?? `请求失败(${resp.status})`);
  return body.data as T;
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};

export const tokenStorage = {
  get user(): { userId: string; nickname: string; roles: string[] } | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set user(u: { userId: string; nickname: string; roles: string[] } | null) {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  }
};
