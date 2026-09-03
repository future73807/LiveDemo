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
        user.requireRole(AuthUser.HOST, AuthUser.ADMIN);
        return ApiResponse.ok(catalog.create(new ProductDraft(req.getTitle(), req.getPrice(),
                req.getImageUrl(), req.getDetailUrl(), req.getStock()), user.userId()));
    }

    @GetMapping
    public ApiResponse<List<Product>> mine(@RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        user.requireRole(AuthUser.HOST, AuthUser.ADMIN);
        return ApiResponse.ok(catalog.listByOwner(user.userId()));
    }
}
