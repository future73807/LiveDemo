import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/endpoints';
import type { Room } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [banId, setBanId] = useState('');
  const [banMsg, setBanMsg] = useState('');
  const [banFailed, setBanFailed] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => { adminApi.rooms().then(setRooms).catch(e => setError(e.message)); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function ban() {
    if (!banId) return;
    try {
      await adminApi.ban(banId, '后台封禁');
      setBanFailed(false);
      setBanMsg(`已封禁用户 ${banId}`);
    } catch (e) {
      setBanFailed(true);
      setBanMsg(e instanceof Error ? e.message : '封禁失败');
    }
  }

  async function unban() {
    if (!banId) return;
    try {
      await adminApi.unban(banId);
      setBanFailed(false);
      setBanMsg(`已解封用户 ${banId}`);
    } catch (e) {
      setBanFailed(true);
      setBanMsg(e instanceof Error ? e.message : '解封失败');
    }
  }

  if (!isAdmin) return <div className="page muted">需要管理员权限</div>;

  return (
    <div className="page">
      <h2 style={{ marginBottom: 12 }}>平台管理</h2>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <table className="list">
          <thead>
            <tr><th>ID</th><th>标题</th><th>主播</th><th>状态</th><th>在线</th><th>操作</th></tr>
          </thead>
          <tbody>
            {rooms.map(r => (
              <tr key={r.id}>
                <td>{r.id}</td><td>{r.title}</td><td>{r.ownerName}</td>
                <td>{r.status === 'LIVING' ? '直播中' : '未开播'}</td>
                <td>{r.viewerCount}</td>
                <td><button className="danger" onClick={() => adminApi.forceClose(r.id).then(refresh)}>强制关播</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>用户封禁</h3>
        <div className="row">
          <input value={banId} onChange={e => setBanId(e.target.value)} placeholder="用户 ID" />
          <button className="danger" onClick={ban}>封禁</button>
          <button onClick={unban}>解封</button>
        </div>
        {banMsg && <div className={banFailed ? 'error-text' : 'muted'} style={{ marginTop: 8 }}>{banMsg}</div>}
      </div>
    </div>
  );
}
