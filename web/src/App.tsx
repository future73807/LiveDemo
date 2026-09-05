import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { nickColor, nickInitial } from './components/nickColor';
import LoginModal from './components/LoginModal';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import AdminPage from './pages/AdminPage';

type Theme = 'dark' | 'light';

/** 日/夜主题：localStorage 持久化，默认跟随系统（index.html 已做首屏防闪烁） */
function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('live.theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('live.theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) };
}

function Topbar() {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  return (
    <div className="topbar">
      <Link to="/" className="brand"><span className="logo">L</span>LiveDemo</Link>
      {isAdmin && <Link to="/admin" className="nav-link">管理后台</Link>}
      <div className="spacer" />
      <button className="theme-toggle" onClick={toggle}
        title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
        aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}>
        {theme === 'dark' ? '日' : '夜'}
      </button>
      {user
        ? <>
            <span className="user-chip">
              <span className="avatar" style={{ background: nickColor(user.nickname) }}>
                {nickInitial(user.nickname)}
              </span>
              <span className="muted">{user.nickname}（{user.roles.join('/')}）</span>
            </span>
            <button className="ghost" onClick={() => { logout(); navigate('/'); }}>退出</button>
          </>
        : <span className="muted">未登录</span>}
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { user, isEmbed, embedAuthFailed, adoptToken } = useAuth();

  // 嵌入模式标记落到 body：CSS 据此把直播间铺满 iframe 视口（无顶栏）
  useEffect(() => {
    if (isEmbed) document.body.dataset.embed = '1';
    else delete document.body.dataset.embed;
    return () => { delete document.body.dataset.embed; };
  }, [isEmbed]);

  // 嵌入 postMessage 双通道（设计 §11-D）：父页发 livedemo-auth 注入登录态
  useEffect(() => {
    if (!isEmbed) return;
    const handler = (e: MessageEvent) => {
      const d = e.data as { type?: string; token?: string } | null;
      if (d?.type === 'livedemo-auth' && typeof d.token === 'string') {
        adoptToken(d.token).catch(() => {});
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isEmbed, adoptToken]);

  // 嵌入模式向父页广播骨架就绪
  useEffect(() => {
    if (isEmbed) window.parent?.postMessage({ type: 'livedemo-ready' }, '*');
  }, [isEmbed]);

  return (
    <>
      {!isEmbed && <Topbar />}
      {isEmbed && embedAuthFailed && !user ? (
        // 嵌入 token 失效：给宿主页一个明确信号，而不是静默白屏
        <div className="embed-denied">
          <p>登录态已失效，请刷新宿主页面重新接入</p>
        </div>
      ) : children}
      {!user && !isEmbed && <LoginModal />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rooms/:id" element={<RoomPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </Gate>
    </AuthProvider>
  );
}
