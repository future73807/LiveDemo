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
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3>购物列表</h3>
          <button onClick={onClose}>关闭</button>
        </div>
        {!entries.length && <div className="muted">购物车是空的</div>}
        {entries.map(e => (
          <div key={e.itemId} className="card" style={{ marginBottom: 10, padding: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div>{e.title}</div>
                <div className="muted">￥{e.price} × {e.qty}</div>
              </div>
              <div className="row">
                <button onClick={() => onUpdateQty(e.itemId, e.qty - 1)} disabled={e.qty <= 1}>-</button>
                <span>{e.qty}</span>
                <button onClick={() => onUpdateQty(e.itemId, e.qty + 1)}>+</button>
                <button className="danger" onClick={() => onRemove(e.itemId)}>移除</button>
              </div>
            </div>
          </div>
        ))}
        <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <span>合计</span><span style={{ color: 'var(--danger)' }}>￥{total.toFixed(2)}</span>
        </div>
      </div>
    </>
  );
}
