import { useEffect } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginModal from './components/LoginModal';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import AdminPage from './pages/AdminPage';

function Topbar() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="topbar">
      <Link to="/"><strong>LiveDemo</strong></Link>
      {isAdmin && <Link to="/admin">管理后台</Link>}
      <div className="spacer" />
      {user
        ? <><span className="muted">{user.nickname}（{user.roles.join('/')}）</span>
            <button onClick={() => { logout(); navigate('/'); }}>退出</button></>
        : <span className="muted">未登录</span>}
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { user, isEmbed, adoptToken } = useAuth();

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
      {children}
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
