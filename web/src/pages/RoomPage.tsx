import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { moderationApi, roomsApi, shelfApi } from '../api/endpoints';
import type { PlayUrls, Room } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { nickColor, nickInitial } from '../components/nickColor';
import Player from '../components/Player';
import DanmakuLayer from '../components/DanmakuLayer';
import ChatPanel from '../components/ChatPanel';
import ProductShelf from '../components/ProductShelf';
import HostPanel from '../components/HostPanel';
import MeetingStage from '../components/MeetingStage';
import { useRoomSocket } from '../realtime/useRoomSocket';

type Tab = 'chat' | 'products' | 'shelf';

export default function RoomPage() {
  const { id } = useParams();
  const roomId = Number(id);
  const navigate = useNavigate();
  const { user, isAdmin, isEmbed } = useAuth();

  const [room, setRoom] = useState<Room | null>(null);
  const [roomMissing, setRoomMissing] = useState(false);
  const [playUrls, setPlayUrls] = useState<PlayUrls | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [notice, setNotice] = useState('');

  const onMuted = useCallback((sec: number) => setNotice(`已被禁言 ${sec} 秒`), []);
  const onError = useCallback((code: string, message: string) => setNotice(`[${code}] ${message}`), []);
  const { state, connected, sendChat } = useRoomSocket(Number.isFinite(roomId) ? roomId : null, { onMuted, onError });

  useEffect(() => {
    roomsApi.get(roomId).then(setRoom).catch(() => setRoomMissing(true));
    roomsApi.playUrls(roomId).then(setPlayUrls).catch(() => {});
  }, [roomId]);

  // 房间状态变化时刷新播放地址
  useEffect(() => {
    if (state.status === 'LIVING') roomsApi.playUrls(roomId).then(setPlayUrls).catch(() => {});
  }, [roomId, state.status]);

  // 嵌入模式：房间状态变化转发父页（livedemo-room-status）
  useEffect(() => {
    if (isEmbed && state.status) {
      window.parent?.postMessage({ type: 'livedemo-room-status', status: state.status }, '*');
    }
  }, [isEmbed, state.status]);

  const isOwner = !!user && room?.ownerId === user.userId;
  const canModerate = !!user && (isOwner || isAdmin);

  async function endStream() {
    await roomsApi.end(roomId);
    navigate('/');
  }

  if (!user) return null;
  if (roomMissing) {
    return (
      <div className="page room-missing">
        <div className="card">
          <h3>房间不存在或已被删除</h3>
          <p className="muted" style={{ margin: '8px 0 16px' }}>该直播间可能已结束或链接有误。</p>
          <button className="primary" onClick={() => navigate('/')}>返回首页</button>
        </div>
      </div>
    );
  }
  if (!room) return <div className="page muted">加载中…</div>;

  const tabs: Array<[Tab, string]> = isOwner
    ? [['chat', '聊天'], ['products', `商品（${state.products.length}）`], ['shelf', '选品']]
    : [['chat', '聊天'], ['products', `商品（${state.products.length}）`]];

  return (
    <div className="page room-page">
      <div className="room-header">
        <div className="row room-title">
          <span className="owner-avatar"
            style={{ width: 38, height: 38, borderRadius: '50%', flex: 'none', display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700,
              background: nickColor(room.ownerName) }}>
            {nickInitial(room.ownerName)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <h2 style={{ fontSize: 17 }}>{room.title}</h2>
              <span className={`badge ${state.status === 'LIVING' ? 'living' : ''}`}>
                {state.status === 'LIVING' ? '直播中' : '未开播'}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>
              {room.ownerName} · {connected ? `${state.viewers} 人在线` : '连接中…'}
            </div>
          </div>
        </div>
      </div>

      <div className="room-main">
        <div className="player-stage">
          {isOwner
            ? <MeetingStage roomId={roomId} roomStatus={state.status} onEnded={endStream} />
            : <Player playUrls={playUrls} status={state.status} />}
          <DanmakuLayer messages={state.messages} />
        </div>

        <aside className="side-panel">
          <div className="tabs">
            {tabs.map(([key, label]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          {tab === 'chat' && (
            <ChatPanel
              messages={state.messages}
              canModerate={canModerate}
              connected={connected}
              onSend={sendChat}
              notice={notice}
              onMute={uid => moderationApi.mute(roomId, uid, 600).catch(e => setNotice(e.message))}
              onDelete={mid => moderationApi.deleteMessage(roomId, mid).catch(e => setNotice(e.message))}
            />
          )}
          {tab === 'products' && (
            <div className="panel-body">
              <ProductShelf products={state.products} />
            </div>
          )}
          {tab === 'shelf' && (
            <div className="panel-body">
              <HostPanel roomId={roomId} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
