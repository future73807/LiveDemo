package com.livedemo.live.commerce;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.commerce.acl.ProductCatalog;
import com.livedemo.live.commerce.acl.ProductDraft;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductCatalog catalog;
    private final ShelfService shelfService;

    @Data
    public static class CreateProductRequest {
        @NotBlank private String title;
        @NotNull private java.math.BigDecimal price;
        private String imageUrl;
        private String detailUrl;
        private int stock;
    }

    @PostMapping
    public ApiResponse<Product> create(@RequestBody CreateProductRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.ADMIN);
        return ApiResponse.ok(catalog.create(new ProductDraft(req.getTitle(), req.getPrice(),
                req.getImageUrl(), req.getDetailUrl(), req.getStock())));
    }

    /** 平台商品库全量列表（主播选品 + 管理端） */
    @GetMapping
    public ApiResponse<List<Product>> list(@RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.HOST, AuthUser.ADMIN);
        return ApiResponse.ok(catalog.list());
    }

    @PatchMapping("/{id}")
    public ApiResponse<Product> update(@PathVariable long id, @RequestBody CreateProductRequest req,
                                       @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.ADMIN);
        return ApiResponse.ok(catalog.update(id, new ProductDraft(req.getTitle(), req.getPrice(),
                req.getImageUrl(), req.getDetailUrl(), req.getStock())));
    }

    /** 删除平台商品：先级联摘除所有在架挂载并广播，再删实体 */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable long id,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.ADMIN);
        shelfService.unmountAll(id);
        catalog.delete(id);
        return ApiResponse.ok(null);
    }
}
