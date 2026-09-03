import type { Product } from '../api/types';

export default function ProductShelf({ products, onAdd }: {
  products: Product[];
  onAdd: (product: Product) => void;
}) {
  if (!products.length) return <div className="muted" style={{ padding: 12 }}>主播暂未上架商品</div>;
  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
      {products.map(p => (
        <div key={p.id} className="card" style={{ marginBottom: 10, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <div>{p.title}</div>
              <div style={{ color: 'var(--danger)' }}>￥{p.price}</div>
            </div>
            <button className="primary" onClick={() => onAdd(p)}>加购</button>
          </div>
        </div>
      ))}
    </div>
  );
}
