package com.livedemo.live.commerce.acl;

import java.math.BigDecimal;

public record ProductDraft(String title, BigDecimal price, String imageUrl, String detailUrl, int stock) {}
