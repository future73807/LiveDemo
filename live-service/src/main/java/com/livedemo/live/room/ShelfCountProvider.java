package com.livedemo.live.room;

/** 房间在架商品数来源，由 commerce.ShelfService 实现（避免房间域直接依赖电商域实现） */
public interface ShelfCountProvider {
    int activeCount(long roomId);
}
