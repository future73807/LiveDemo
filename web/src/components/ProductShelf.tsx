import type { Product } from '../api/types';

/** 只有 http(s) 才渲染为链接：detailUrl 来自管理端自由输入，javascript:/data: 等伪协议必须 neutralize */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 商品卡：有安全详情链接则整卡直达（新标签页打开），无链接/不安全链接仅展示 */
function ProductCard({ p }: { p: Product }) {
  const body = (
    <>
      {p.imageUrl
        ? <img className="p-img" src={p.imageUrl} alt="" loading="lazy" />
        : <span className="p-ph">{p.title.slice(0, 1)}</span>}
      <div className="p-info">
        <div className="p-title">{p.title}</div>
        <div className="p-price">￥{p.price}</div>
      </div>
      {p.detailUrl && isSafeUrl(p.detailUrl) && <span className="p-go">查看</span>}
    </>
  );
  const linkable = !!p.detailUrl && isSafeUrl(p.detailUrl);
  const cls = 'product-card';
  return linkable
    ? <a className={cls} href={p.detailUrl!} target="_blank" rel="noopener noreferrer">{body}</a>
    : <div className={cls}>{body}</div>;
}

export default function ProductShelf({ products }: {
  products: Product[];
}) {
  if (!products.length) return <div className="empty-hint">主播暂未上架商品</div>;
  return (
    <div className="shelf-list">
      {products.map(p => <ProductCard key={p.id} p={p} />)}
    </div>
  );
}
