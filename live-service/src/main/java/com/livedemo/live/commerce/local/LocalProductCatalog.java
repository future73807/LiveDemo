package com.livedemo.live.commerce.local;

import com.livedemo.live.common.BusinessException;
import com.livedemo.live.commerce.Product;
import com.livedemo.live.commerce.ProductRepository;
import com.livedemo.live.commerce.acl.ProductCatalog;
import com.livedemo.live.commerce.acl.ProductDraft;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

@Component
@RequiredArgsConstructor
public class LocalProductCatalog implements ProductCatalog {

    private final ProductRepository repo;

    @Override
    public Product create(ProductDraft draft) {
        return repo.save(Product.builder()
                .ownerId("platform")
                .title(draft.title())
                .price(draft.price())
                .imageUrl(draft.imageUrl())
                .detailUrl(draft.detailUrl())
                .stock(draft.stock())
                .createdAt(LocalDateTime.now())
                .build());
    }

    @Override
    public Product update(long productId, ProductDraft draft) {
        Product product = get(productId);
        product.setTitle(draft.title());
        product.setPrice(draft.price());
        product.setImageUrl(draft.imageUrl());
        product.setDetailUrl(draft.detailUrl());
        product.setStock(draft.stock());
        return repo.save(product);
    }

    @Override
    public void delete(long productId) {
        repo.deleteById(productId);
    }

    @Override
    public List<Product> list() {
        return repo.findAll(Sort.by(Sort.Direction.DESC, "id"));
    }

    @Override
    public Product get(long productId) {
        return repo.findById(productId).orElseThrow(() -> BusinessException.notFound("商品不存在"));
    }
}
