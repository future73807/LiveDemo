package com.livedemo.live.commerce.acl;

import com.livedemo.live.commerce.Product;

import java.util.List;

/** 商品目录 ACL：demo 用本地表实现；接入期替换为现有系统商品库 HTTP 客户端（设计 §5.2） */
public interface ProductCatalog {
    Product create(ProductDraft draft, String ownerId);
    List<Product> listByOwner(String ownerId);
    /** 不存在抛 404 */
    Product get(long productId);
}
