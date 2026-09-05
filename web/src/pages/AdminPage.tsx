import { useCallback, useEffect, useState } from 'react';
import { adminApi, productsApi } from '../api/endpoints';
import type { Product, Room } from '../api/types';
import { useAuth } from '../auth/AuthContext';

type Tab = 'rooms' | 'products' | 'bans';

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('rooms');
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
      <h2 style={{ marginBottom: 16 }}>平台管理</h2>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="tabs" style={{ marginBottom: 16, borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)' }}>
        <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}>房间</button>
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>商品</button>
        <button className={tab === 'bans' ? 'active' : ''} onClick={() => setTab('bans')}>封禁</button>
      </div>

      {tab === 'rooms' && (
        <div className="card">
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
          {!rooms.length && <div className="empty-hint">暂无房间</div>}
        </div>
      )}

      {tab === 'products' && <ProductsTab />}

      {tab === 'bans' && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>用户封禁</h3>
          <div className="row">
            <input value={banId} onChange={e => setBanId(e.target.value)} placeholder="用户 ID" />
            <button className="danger" onClick={ban}>封禁</button>
            <button onClick={unban}>解封</button>
          </div>
          {banMsg && <div className={banFailed ? 'error-text' : 'muted'} style={{ marginTop: 8 }}>{banMsg}</div>}
        </div>
      )}
    </div>
  );
}

function ProductsTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [editing, setEditing] = useState<{ id: number; price: string } | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const refresh = useCallback(() => { productsApi.list().then(setProducts).catch(e => setError(e.message)); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function create() {
    const value = Number(price);
    if (!title.trim() || !(value > 0)) { setError('请填写商品名与有效价格'); return; }
    try {
      await productsApi.create({ title: title.trim(), price: value, imageUrl: imageUrl.trim() || undefined });
      setTitle(''); setPrice(''); setImageUrl(''); setError(''); setMsg('商品已创建');
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '创建失败'); }
  }

  async function savePrice(p: Product) {
    const value = Number(editing?.price);
    if (!(value > 0)) { setError('请输入有效价格'); return; }
    try {
      await productsApi.update(p.id, {
        title: p.title, price: value,
        imageUrl: p.imageUrl ?? undefined, detailUrl: p.detailUrl ?? undefined
      });
      setEditing(null); setError(''); setMsg(`已更新「${p.title}」价格`);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败'); }
  }

  async function remove(p: Product) {
    try {
      await productsApi.remove(p.id);
      setError(''); setMsg(`已删除「${p.title}」（在架商品同步摘除）`);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '删除失败'); }
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 8 }}>新建商品</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="商品名" style={{ flex: 1, minWidth: 160 }} />
          <input value={price} onChange={e => setPrice(e.target.value)} placeholder="价格" style={{ width: 90 }} />
          <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="图片链接（可选）" style={{ flex: 1, minWidth: 160 }} />
          <button className="primary" onClick={create}>添加商品</button>
        </div>
        {(error || msg) && <div className={error ? 'error-text' : 'muted'} style={{ marginTop: 8 }}>{error || msg}</div>}
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>商品库</h3>
        {products.map(p => (
          <div key={p.id} className="row flex-between" style={{ marginBottom: 6 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.title}（￥{p.price}）
            </span>
            <div className="row" style={{ flex: 'none' }}>
              {editing?.id === p.id ? (
                <>
                  <input value={editing.price} onChange={e => setEditing({ id: p.id, price: e.target.value })}
                    placeholder="新价格" style={{ width: 90 }} />
                  <button className="primary" onClick={() => savePrice(p)}>保存</button>
                  <button onClick={() => setEditing(null)}>取消</button>
                </>
              ) : (
                <button onClick={() => setEditing({ id: p.id, price: String(p.price) })}>改价</button>
              )}
              <button className="danger" onClick={() => remove(p)}>删除</button>
            </div>
          </div>
        ))}
        {!products.length && <div className="empty-hint">商品库为空</div>}
      </div>
    </>
  );
}
