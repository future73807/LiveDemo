import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function LoginModal() {
  const { authMode, login, loginPassword, registerAccount } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [userId, setUserId] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [regNickname, setRegNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitDevToken() {
    if (!userId.trim() || !nickname.trim()) { setError('请填写用户 ID 与昵称'); return; }
    setBusy(true);
    try {
      await login(userId.trim(), nickname.trim(), [role]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin() {
    if (!username.trim() || !password) { setError('请填写用户名与密码'); return; }
    setBusy(true);
    try {
      await loginPassword(username.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister() {
    if (!username.trim() || !password || !regNickname.trim()) { setError('请填写用户名、密码与昵称'); return; }
    setBusy(true);
    try {
      await registerAccount({ username: username.trim(), password, nickname: regNickname.trim(), role });
    } catch (e) {
      setError(e instanceof Error ? e.message : '注册失败');
    } finally {
      setBusy(false);
    }
  }

  if (authMode !== 'internal') {
    // jwt/gateway 接入期：dev-token 直签 UI 原样保留
    return (
      <div className="dialog-mask">
        <div className="dialog">
          <h3>登录（demo 签发测试 JWT）</h3>
          <div className="field">
            <label>用户 ID</label>
            <input value={userId} onChange={e => setUserId(e.target.value)} placeholder="如 host1 / v1" />
          </div>
          <div className="field">
            <label>昵称</label>
            <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="直播间展示名" />
          </div>
          <div className="field">
            <label>角色</label>
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="VIEWER">观众</option>
              <option value="HOST">主播</option>
              <option value="ADMIN">管理员</option>
            </select>
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="primary w-full" disabled={busy} onClick={submitDevToken}>
            {busy ? '登录中…' : '进入'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-mask">
      <div className="dialog">
        <h3>登录 LiveDemo</h3>
        <div className="tabs" style={{ marginBottom: 14 }}>
          <button className={tab === 'login' ? 'active' : ''} onClick={() => { setTab('login'); setError(''); }}>登录</button>
          <button className={tab === 'register' ? 'active' : ''} onClick={() => { setTab('register'); setError(''); }}>注册</button>
        </div>
        {tab === 'login' ? (
          <>
            <div className="field">
              <label>用户名</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名" />
            </div>
            <div className="field">
              <label>密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码"
                onKeyDown={e => { if (e.key === 'Enter') submitLogin(); }} />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="primary w-full" disabled={busy} onClick={submitLogin}>
              {busy ? '登录中…' : '进入'}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>用户名</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="4-32 位字母数字下划线" />
            </div>
            <div className="field">
              <label>密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位" />
            </div>
            <div className="field">
              <label>昵称</label>
              <input value={regNickname} onChange={e => setRegNickname(e.target.value)} placeholder="直播间展示名" />
            </div>
            <div className="field">
              <label>角色</label>
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="VIEWER">观众</option>
                <option value="HOST">主播</option>
              </select>
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="primary w-full" disabled={busy} onClick={submitRegister}>
              {busy ? '注册中…' : '注册并进入'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
