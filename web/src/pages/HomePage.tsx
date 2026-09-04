import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomsApi } from '../api/endpoints';
import type { Room } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { nickColor, nickInitial } from '../components/nickColor';

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
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <h2>直播间</h2>
        {isHost && <button className="primary" onClick={() => setCreating(true)}>创建房间</button>}
      </div>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="grid">
        {rooms.map(room => {
          const living = room.status === 'LIVING';
          return (
            <div key={room.id} className="card room-card" onClick={() => navigate(`/rooms/${room.id}`)}>
              <div className="cover">
                <div className="play-hint"><span className="play-btn">GO</span></div>
                <span className={`status-pill ${living ? 'living' : ''}`}>
                  <span className="dot" />{living ? '直播中' : '未开播'}
                </span>
                {living && <span className="viewers-pill">{room.viewerCount} 人在看</span>}
              </div>
              <div className="meta">
                <div className="title">{room.title}</div>
                <div className="sub">
                  <span className="owner-avatar" style={{ background: nickColor(room.ownerName) }}>
                    {nickInitial(room.ownerName)}
                  </span>
                  <span>{room.ownerName}</span>
                  <span>·</span>
                  <span>{room.productCount} 件商品</span>
                </div>
              </div>
            </div>
          );
        })}
        {!rooms.length && <div className="empty-hint" style={{ gridColumn: '1 / -1' }}>
          <span className="ph-icon">···</span>暂无房间，{isHost ? '点击右上角创建' : '等待主播开播'}
        </div>}
      </div>

      {creating && (
        <div className="dialog-mask" onClick={() => setCreating(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>创建房间</h3>
            <div className="field">
              <label>房间标题</label>
              <input value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            </div>
            <button className="primary w-full" onClick={createRoom}>创建</button>
          </div>
        </div>
      )}

      {created && (
        <div className="dialog-mask">
          <div className="dialog">
            <h3>房间已创建</h3>
            <div className="muted" style={{ marginBottom: 12 }}>
              提示：{user?.nickname}，推流开始后房间自动转为「直播中」。
            </div>
            <button className="primary w-full"
              onClick={() => navigate(`/rooms/${created.id}`)}>进入直播间</button>
          </div>
        </div>
      )}
    </div>
  );
}
