package com.livedemo.live.commerce.acl;

import java.util.List;

/** 购物车 ACL：demo 本地实现；接入期替换为现有系统购物车 API（设计 §5.2） */
public interface CartService {
    List<CartEntry> list(String userId);
    /** roomId 非空时校验该商品仍在该房间货架（设计 §5.7 摘除校验） */
    CartEntry add(String userId, long productId, int qty, Long roomId);
    CartEntry updateQty(String userId, long itemId, int qty);
    void remove(String userId, long itemId);
}
