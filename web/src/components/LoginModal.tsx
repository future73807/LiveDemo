import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function LoginModal() {
  const { login } = useAuth();
  const [userId, setUserId] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
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
        <button className="primary" disabled={busy} onClick={submit} style={{ width: '100%' }}>
          {busy ? '登录中…' : '进入'}
        </button>
      </div>
    </div>
  );
}
