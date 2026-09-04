import { useCallback, useEffect, useState } from 'react';
import { productsApi, shelfApi } from '../api/endpoints';
import type { Product } from '../api/types';

export default function HostPanel({ roomId }: { roomId: number }) {
  const [mounted, setMounted] = useState<Product[]>([]);
  const [library, setLibrary] = useState<Product[]>([]);
  const [kw, setKw] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [shelf, lib] = await Promise.all([shelfApi.list(roomId), productsApi.list()]);
      setMounted(shelf);
      setLibrary(lib);
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
  }, [roomId]);
  useEffect(() => { refresh(); }, [refresh]);

  // 搜索时重新拉取平台库（防抖）：管理员可能在主播页打开后新建商品，本地缓存会过期
  const refreshLibrary = useCallback(async () => {
    try { setLibrary(await productsApi.list()); } catch { /* 静默：保留旧列表 */ }
  }, []);
  useEffect(() => {
    if (!kw) return;
    const t = setTimeout(refreshLibrary, 300);
    return () => clearTimeout(t);
  }, [kw, refreshLibrary]);

  const mountedIds = new Set(mounted.map(p => p.id));
  const filtered = library.filter(p => !kw || p.title.includes(kw));

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginBottom: 8 }}>选品挂载</h3>
      {error && <div className="error-text">{error}</div>}
      <div className="section-label">已挂载（点击摘除）</div>
      {mounted.map(p => (
        <div key={p.id} className="row flex-between" style={{ marginBottom: 6 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.title}（￥{p.price}）
          </span>
          <button className="danger" style={{ flex: 'none' }} onClick={() => shelfApi.unmount(roomId, p.id).then(refresh)}>摘除</button>
        </div>
      ))}
      {!mounted.length && <div className="muted" style={{ fontSize: 13 }}>暂未挂载商品</div>}
      <div className="section-label">平台商品库</div>
      <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索商品" style={{ width: '100%', marginBottom: 8 }} />
      {filtered.map(p => (
        <div key={p.id} className="row flex-between" style={{ marginBottom: 6 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.title}（￥{p.price}）
          </span>
          <button className="primary" style={{ flex: 'none' }} disabled={mountedIds.has(p.id)}
            onClick={() => shelfApi.mount(roomId, p.id).then(refresh)}>
            {mountedIds.has(p.id) ? '已挂载' : '挂载'}
          </button>
        </div>
      ))}
      {!filtered.length && <div className="empty-hint">商品库为空，请联系管理员配置</div>}
    </div>
  );
}
