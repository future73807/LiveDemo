package com.livedemo.live.commerce.acl;

import com.livedemo.live.commerce.Product;

import java.util.List;

/** 商品目录 ACL：平台统一商品库语义（ADMIN 维护、主播选品）；demo 用本地表实现，接入期替换为现有系统商品库 HTTP 客户端（设计 §5.2） */
public interface ProductCatalog {
    Product create(ProductDraft draft);
    Product update(long productId, ProductDraft draft);
    /** 删除平台商品（在架挂载的级联摘除由 ShelfService 负责） */
    void delete(long productId);
    /** 全库列表（选品用） */
    List<Product> list();
    /** 不存在抛 404 */
    Product get(long productId);
}
