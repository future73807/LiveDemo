import type { CartEntry } from '../api/types';

export default function CartDrawer({ open, entries, onClose, onUpdateQty, onRemove }: {
  open: boolean;
  entries: CartEntry[];
  onClose: () => void;
  onUpdateQty: (itemId: number, qty: number) => void;
  onRemove: (itemId: number) => void;
}) {
  if (!open) return null;
  const total = entries.reduce((sum, e) => sum + e.price * e.qty, 0);
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <h3>购物列表</h3>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        {!entries.length && <div className="empty-hint"><span className="ph-icon">···</span>购物车是空的</div>}
        {entries.map(e => (
          <div key={e.itemId} className="card product-card" style={{ marginBottom: 10 }}>
            <div className="flex-between">
              <div style={{ minWidth: 0 }}>
                <div className="p-title">{e.title}</div>
                <div className="muted">￥{e.price} × {e.qty}</div>
              </div>
              <div className="row">
                <span className="qty-stepper">
                  <button onClick={() => onUpdateQty(e.itemId, e.qty - 1)} disabled={e.qty <= 1}>-</button>
                  <span style={{ minWidth: 20, textAlign: 'center' }}>{e.qty}</span>
                  <button onClick={() => onUpdateQty(e.itemId, e.qty + 1)}>+</button>
                </span>
                <button className="danger" onClick={() => onRemove(e.itemId)}>移除</button>
              </div>
            </div>
          </div>
        ))}
        <div className="drawer-foot">
          <span>合计</span><span className="total">￥{total.toFixed(2)}</span>
        </div>
      </div>
    </>
  );
}
