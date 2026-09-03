package com.livedemo.live.commerce.acl;

import java.math.BigDecimal;

public record CartEntry(long itemId, long productId, String title, BigDecimal price, String imageUrl, int qty) {}
