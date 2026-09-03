package com.livedemo.live.commerce;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.commerce.acl.CartEntry;
import com.livedemo.live.commerce.acl.CartService;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/cart")
@RequiredArgsConstructor
public class CartController {

    private final CartService cartService;

    @Data
    public static class AddCartRequest {
        @NotNull private Long productId;
        private int qty = 1;
        /** 可选：从直播间加购时传入，用于货架校验 */
        private Long roomId;
    }

    @Data
    public static class UpdateQtyRequest {
        @NotNull private Integer qty;
    }

    @GetMapping
    public ApiResponse<List<CartEntry>> list(@RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(cartService.list(user.userId()));
    }

    @PostMapping("/items")
    public ApiResponse<CartEntry> add(@RequestBody AddCartRequest req,
                                      @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(cartService.add(user.userId(), req.getProductId(), req.getQty(), req.getRoomId()));
    }

    @PatchMapping("/items/{itemId}")
    public ApiResponse<CartEntry> updateQty(@PathVariable long itemId, @RequestBody UpdateQtyRequest req,
                                            @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        return ApiResponse.ok(cartService.updateQty(user.userId(), itemId, req.getQty()));
    }

    @DeleteMapping("/items/{itemId}")
    public ApiResponse<Void> remove(@PathVariable long itemId,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        cartService.remove(user.userId(), itemId);
        return ApiResponse.ok(null);
    }
}
