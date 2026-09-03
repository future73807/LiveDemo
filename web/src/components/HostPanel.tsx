import { useEffect, useState } from 'react';
import { productsApi, shelfApi } from '../api/endpoints';
import type { Product } from '../api/types';

export default function HostPanel({ roomId, onEnd }: { roomId: number; onEnd: () => void }) {
  const [mine, setMine] = useState<Product[]>([]);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    setMine(await productsApi.mine());
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);

  async function createProduct() {
    const value = Number(price);
    if (!title.trim() || !(value > 0)) { setError('请填写商品名与有效价格'); return; }
    await productsApi.create({ title: title.trim(), price: value });
    setTitle(''); setPrice('');
    await refresh();
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginBottom: 8 }}>主播管理</h3>
      {error && <div className="error-text">{error}</div>}
      <div className="row" style={{ marginBottom: 10 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="商品名" style={{ flex: 1 }} />
        <input value={price} onChange={e => setPrice(e.target.value)} placeholder="价格" style={{ width: 90 }} />
        <button className="primary" onClick={createProduct}>添加商品</button>
      </div>
      {mine.map(p => (
        <div key={p.id} className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span>{p.title}（￥{p.price}）</span>
          <div className="row">
            <button onClick={() => shelfApi.mount(roomId, p.id)}>挂载</button>
            <button className="danger" onClick={() => shelfApi.unmount(roomId, p.id)}>摘除</button>
          </div>
        </div>
      ))}
      <button className="danger" style={{ marginTop: 8 }} onClick={onEnd}>结束直播</button>
    </div>
  );
}
