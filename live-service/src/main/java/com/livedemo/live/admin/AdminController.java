package com.livedemo.live.admin;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.room.RoomDto;
import com.livedemo.live.room.RoomService;
import com.livedemo.live.safety.BanService;
import com.livedemo.live.safety.SensitiveWordFilter;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final RoomService roomService;
    private final BanService banService;
    private final SensitiveWordFilter wordFilter;

    @Data
    public static class BanRequest { private String reason; }

    private void requireAdmin(AuthUser user) { user.requireRole(AuthUser.ADMIN); }

    @GetMapping("/rooms")
    public ApiResponse<List<RoomDto>> rooms(@RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        return ApiResponse.ok(roomService.list(null).stream()
                .map(r -> RoomDto.of(r, null, false, roomService.viewers(r.getId()), roomService.productCount(r.getId())))
                .toList());
    }

    @PostMapping("/rooms/{id}/force-close")
    public ApiResponse<RoomDto> forceClose(@PathVariable long id,
                                           @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        return ApiResponse.ok(RoomDto.of(roomService.forceClose(id, user.userId()), null, false, 0, 0));
    }

    @PostMapping("/users/{userId}/ban")
    public ApiResponse<Void> ban(@PathVariable String userId, @RequestBody BanRequest req,
                                 @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        banService.ban(userId, req.getReason());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/users/{userId}/ban")
    public ApiResponse<Void> unban(@PathVariable String userId,
                                   @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        banService.unban(userId);
        return ApiResponse.ok(null);
    }

    @PostMapping("/sensitive-words/reload")
    public ApiResponse<Map<String, Object>> reloadWords(@RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireAdmin(user);
        wordFilter.reload();
        return ApiResponse.ok(Map.of("count", wordFilter.currentWords().size()));
    }
}
