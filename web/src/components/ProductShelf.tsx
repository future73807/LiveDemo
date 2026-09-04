import type { Product } from '../api/types';

export default function ProductShelf({ products, onAdd }: {
  products: Product[];
  onAdd: (product: Product) => void;
}) {
  if (!products.length) return <div className="empty-hint"><span className="ph-icon">···</span>主播暂未上架商品</div>;
  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
      {products.map(p => (
        <div key={p.id} className="card product-card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div className="p-title">{p.title}</div>
              <div className="p-price">￥{p.price}</div>
            </div>
            <button className="primary" style={{ flex: 'none' }} onClick={() => onAdd(p)}>加购</button>
          </div>
        </div>
      ))}
    </div>
  );
}
