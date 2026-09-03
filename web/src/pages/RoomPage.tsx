import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cartApi, moderationApi, roomsApi, shelfApi } from '../api/endpoints';
import type { CartEntry, PlayUrls, Room } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import Player from '../components/Player';
import DanmakuLayer from '../components/DanmakuLayer';
import ChatPanel from '../components/ChatPanel';
import ProductShelf from '../components/ProductShelf';
import CartDrawer from '../components/CartDrawer';
import HostPanel from '../components/HostPanel';
import { useRoomSocket } from '../realtime/useRoomSocket';

export default function RoomPage() {
  const { id } = useParams();
  const roomId = Number(id);
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const [room, setRoom] = useState<Room | null>(null);
  const [playUrls, setPlayUrls] = useState<PlayUrls | null>(null);
  const [tab, setTab] = useState<'chat' | 'products'>('chat');
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [notice, setNotice] = useState('');

  const onMuted = useCallback((sec: number) => setNotice(`已被禁言 ${sec} 秒`), []);
  const onError = useCallback((code: string, message: string) => setNotice(`[${code}] ${message}`), []);
  const { state, connected, sendChat } = useRoomSocket(Number.isFinite(roomId) ? roomId : null, { onMuted, onError });

  const deletedIds = useMemo(() => new Set<string>(), []);   // 删除即时从 state 移除，无需额外集合

  const refreshCart = useCallback(() => { cartApi.list().then(setCart).catch(() => {}); }, []);
  const cartCount = cart.reduce((sum, e) => sum + e.qty, 0);

  useEffect(() => {
    roomsApi.get(roomId).then(setRoom).catch(e => setNotice(e.message));
    roomsApi.playUrls(roomId).then(setPlayUrls).catch(() => {});
    refreshCart();
  }, [roomId, refreshCart]);

  // 房间状态变化时刷新播放地址
  useEffect(() => {
    if (state.status === 'LIVING') roomsApi.playUrls(roomId).then(setPlayUrls).catch(() => {});
  }, [roomId, state.status]);

  const isOwner = !!user && room?.ownerId === user.userId;
  const canModerate = !!user && (isOwner || isAdmin);

  async function addCart(productId: number) {
    try {
      await cartApi.add(productId, 1, roomId);
      refreshCart();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '加购失败');
    }
  }

  async function endStream() {
    await roomsApi.end(roomId);
    navigate('/');
  }

  if (!user) return null;
  if (!room) return <div className="page muted">加载中…</div>;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="row">
          <h2>{room.title}</h2>
          <span className={`badge ${state.status === 'LIVING' ? 'living' : ''}`}>
            {state.status === 'LIVING' ? '直播中' : '未开播'}
          </span>
          <span className="muted">{connected ? `${state.viewers} 人在线` : '连接中…'}</span>
        </div>
        <div className="row">
          <button onClick={() => setCartOpen(true)}>🛒 购物车{cartCount > 0 ? `(${cartCount})` : ''}</button>
        </div>
      </div>

      <div className="room-layout">
        <div>
          <Player playUrls={playUrls} status={state.status} />
          <DanmakuLayer messages={state.messages} deletedIds={deletedIds} />
          {isOwner && <HostPanel roomId={roomId} onEnd={endStream} />}
        </div>

        <div className="side-panel">
          <div className="tabs">
            <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>聊天</button>
            <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
              商品（{state.products.length}）
            </button>
          </div>
          {tab === 'chat' ? (
            <ChatPanel
              messages={state.messages}
              canModerate={canModerate}
              onSend={sendChat}
              notice={notice}
              onMute={uid => moderationApi.mute(roomId, uid, 600).catch(e => setNotice(e.message))}
              onDelete={mid => moderationApi.deleteMessage(roomId, mid).catch(e => setNotice(e.message))}
            />
          ) : (
            <ProductShelf products={state.products} onAdd={p => addCart(p.id)} />
          )}
        </div>
      </div>

      <CartDrawer
        open={cartOpen}
        entries={cart}
        onClose={() => setCartOpen(false)}
        onUpdateQty={(itemId, qty) => cartApi.updateQty(itemId, qty).then(refreshCart)}
        onRemove={itemId => cartApi.remove(itemId).then(refreshCart)}
      />
    </div>
  );
}
