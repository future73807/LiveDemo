import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomsApi } from '../api/endpoints';
import type { Room } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export default function HomePage() {
  const { user, isHost } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [created, setCreated] = useState<Room | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try { setRooms(await roomsApi.list()); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);   // 列表页轮询兜底（状态推送只在房间页 WS 内）
    return () => clearInterval(timer);
  }, [refresh]);

  async function createRoom() {
    try {
      const room = await roomsApi.create(title.trim() || '未命名直播间');
      setCreated(room);
      setCreating(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>直播间</h2>
        {isHost && <button className="primary" onClick={() => setCreating(true)}>创建房间</button>}
      </div>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="grid">
        {rooms.map(room => (
          <div key={room.id} className="card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/rooms/${room.id}`)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{room.title}</strong>
              <span className={`badge ${room.status === 'LIVING' ? 'living' : ''}`}>
                {room.status === 'LIVING' ? '直播中' : '未开播'}
              </span>
            </div>
            <div className="muted">{room.ownerName} · {room.viewerCount} 人在看 · {room.productCount} 件商品</div>
          </div>
        ))}
        {!rooms.length && <div className="muted">暂无房间，{isHost ? '点击右上角创建' : '等待主播开播'}</div>}
      </div>

      {creating && (
        <div className="dialog-mask" onClick={() => setCreating(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>创建房间</h3>
            <div className="field">
              <label>房间标题</label>
              <input value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            </div>
            <button className="primary" style={{ width: '100%' }} onClick={createRoom}>创建</button>
          </div>
        </div>
      )}

      {created && (
        <div className="dialog-mask">
          <div className="dialog">
            <h3>房间已创建，去推流吧</h3>
            <div className="field">
              <label>推流服务器（OBS）</label>
              <input readOnly value={created.pushUrl?.replace(/\/[^/]+$/, '') ?? ''} />
            </div>
            <div className="field">
              <label>推流码</label>
              <input readOnly value={created.streamKey ?? ''} />
            </div>
            <div className="muted" style={{ marginBottom: 12 }}>
              提示：{user?.nickname}，推流开始后房间自动转为「直播中」。
            </div>
            <button className="primary" style={{ width: '100%' }}
              onClick={() => navigate(`/rooms/${created.id}`)}>进入直播间</button>
          </div>
        </div>
      )}
    </div>
  );
}
