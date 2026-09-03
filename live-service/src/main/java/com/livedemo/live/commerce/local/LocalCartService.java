package com.livedemo.live.commerce.local;

import com.livedemo.live.common.BusinessException;
import com.livedemo.live.commerce.CartItem;
import com.livedemo.live.commerce.CartItemRepository;
import com.livedemo.live.commerce.Product;
import com.livedemo.live.commerce.ProductRepository;
import com.livedemo.live.commerce.RoomProduct;
import com.livedemo.live.commerce.RoomProductRepository;
import com.livedemo.live.commerce.acl.CartEntry;
import com.livedemo.live.commerce.acl.CartService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
@RequiredArgsConstructor
public class LocalCartService implements CartService {

    private final ProductRepository productRepo;
    private final CartItemRepository cartRepo;
    private final RoomProductRepository shelfRepo;

    @Override
    @Transactional
    public CartEntry add(String userId, long productId, int qty, Long roomId) {
        Product product = productRepo.findById(productId)
                .orElseThrow(() -> BusinessException.notFound("商品不存在"));
        if (qty <= 0) throw BusinessException.badRequest("数量必须大于 0");
        if (roomId != null) {
            shelfRepo.findByRoomIdAndProductId(roomId, productId)
                    .filter(mount -> mount.isActive())
                    .orElseThrow(() -> BusinessException.badRequest("该商品已从货架摘除"));
        }
        CartItem item = cartRepo.findByUserIdAndProductId(userId, productId)
                .map(existing -> {
                    existing.setQty(existing.getQty() + qty);
                    return existing;
                })
                .orElseGet(() -> CartItem.builder().userId(userId).productId(productId).qty(qty).build());
        return toEntry(cartRepo.save(item), product);
    }

    @Override
    public List<CartEntry> list(String userId) {
        return cartRepo.findAll().stream()
                .filter(i -> i.getUserId().equals(userId))
                .map(item -> toEntry(item, productRepo.findById(item.getProductId()).orElse(null)))
                .filter(e -> e.title() != null)
                .toList();
    }

    @Override
    @Transactional
    public CartEntry updateQty(String userId, long itemId, int qty) {
        if (qty <= 0) throw BusinessException.badRequest("数量必须大于 0");
        CartItem item = cartRepo.findByIdAndUserId(itemId, userId)
                .orElseThrow(() -> BusinessException.notFound("购物车条目不存在"));
        item.setQty(qty);
        return toEntry(cartRepo.save(item),
                productRepo.findById(item.getProductId()).orElseThrow(() -> BusinessException.notFound("商品不存在")));
    }

    @Override
    @Transactional
    public void remove(String userId, long itemId) {
        if (!cartRepo.existsByIdAndUserId(itemId, userId)) {
            throw BusinessException.notFound("购物车条目不存在");
        }
        cartRepo.deleteById(itemId);
    }

    private CartEntry toEntry(CartItem item, Product product) {
        // 计划笔误修复：mock 单测中 save 不回填 id，Long 拆箱会 NPE；null 时取 0（生产 JPA 会回填 id，行为不变）
        long itemId = item.getId() == null ? 0L : item.getId();
        if (product == null) return new CartEntry(itemId, item.getProductId(), null, null, null, item.getQty());
        return new CartEntry(itemId, product.getId(), product.getTitle(), product.getPrice(),
                product.getImageUrl(), item.getQty());
    }
}
