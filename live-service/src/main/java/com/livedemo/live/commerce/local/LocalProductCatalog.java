package com.livedemo.live.commerce.local;

import com.livedemo.live.common.BusinessException;
import com.livedemo.live.commerce.Product;
import com.livedemo.live.commerce.ProductRepository;
import com.livedemo.live.commerce.acl.ProductCatalog;
import com.livedemo.live.commerce.acl.ProductDraft;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

@Component
@RequiredArgsConstructor
public class LocalProductCatalog implements ProductCatalog {

    private final ProductRepository repo;

    @Override
    public Product create(ProductDraft draft, String ownerId) {
        return repo.save(Product.builder()
                .ownerId(ownerId)
                .title(draft.title())
                .price(draft.price())
                .imageUrl(draft.imageUrl())
                .detailUrl(draft.detailUrl())
                .stock(draft.stock())
                .createdAt(LocalDateTime.now())
                .build());
    }

    @Override
    public List<Product> listByOwner(String ownerId) {
        return repo.findByOwnerIdOrderByIdDesc(ownerId);
    }

    @Override
    public Product get(long productId) {
        return repo.findById(productId).orElseThrow(() -> BusinessException.notFound("商品不存在"));
    }
}
