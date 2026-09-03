package com.livedemo.live.commerce;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequiredArgsConstructor
public class ShelfController {

    private final ShelfService shelfService;

    @Data
    public static class MountRequest {
        @NotNull private Long productId;
        private int sort;
    }

    @GetMapping("/api/rooms/{id}/products")
    public ApiResponse<List<Map<String, Object>>> list(@PathVariable long id) {
        return ApiResponse.ok(shelfService.listActive(id));
    }

    @PostMapping("/api/rooms/{id}/products")
    public ApiResponse<Void> mount(@PathVariable long id, @RequestBody MountRequest req,
                                   @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        shelfService.mount(id, req.getProductId(), req.getSort(), user);
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/api/rooms/{id}/products/{productId}")
    public ApiResponse<Void> unmount(@PathVariable long id, @PathVariable long productId,
                                     @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        shelfService.unmount(id, productId, user);
        return ApiResponse.ok(null);
    }
}
