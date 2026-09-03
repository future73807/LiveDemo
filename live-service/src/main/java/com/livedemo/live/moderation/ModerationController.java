package com.livedemo.live.moderation;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.TokenAuthFilter;
import com.livedemo.live.chat.ChatService;
import com.livedemo.live.common.ApiResponse;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.room.Room;
import com.livedemo.live.room.RoomService;
import com.livedemo.live.safety.MuteService;
import com.livedemo.live.ws.RoomSessionRegistry;
import com.livedemo.live.ws.WsEventSender;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/rooms/{id}")
@RequiredArgsConstructor
public class ModerationController {

    private final RoomService roomService;
    private final ChatService chatService;
    private final MuteService muteService;
    private final RoomSessionRegistry registry;
    private final WsEventSender sender;

    @Data
    public static class MuteRequest {
        @jakarta.validation.constraints.NotBlank private String userId;
        private long durationSec = 600;
    }

    private Room requireModerator(long roomId, AuthUser user) {
        Room room = roomService.get(roomId);
        if (!room.getOwnerId().equals(user.userId())) {
            user.requireRole(AuthUser.ADMIN);
        }
        return room;
    }

    @DeleteMapping("/messages/{messageId}")
    public ApiResponse<Void> deleteMessage(@PathVariable long id, @PathVariable String messageId,
                                           @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireModerator(id, user);
        if (!chatService.removeMessage(id, messageId)) {
            throw BusinessException.notFound("弹幕不存在或已删除");
        }
        sender.broadcast(id, Map.of("type", "message_deleted", "messageId", messageId));
        return ApiResponse.ok(null);
    }

    @PostMapping("/mutes")
    public ApiResponse<Void> mute(@PathVariable long id, @RequestBody MuteRequest req,
                                  @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireModerator(id, user);
        muteService.mute(id, req.getUserId(), req.getDurationSec());
        // 定向通知被禁言者（设计 §5.5 muted 事件）
        registry.sessions(id).stream()
                .filter(info -> info.userId().equals(req.getUserId()))
                .forEach(info -> sender.send(info.session(),
                        Map.of("type", "muted", "durationSec", req.getDurationSec())));
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/mutes/{userId}")
    public ApiResponse<Void> unmute(@PathVariable long id, @PathVariable String userId,
                                    @RequestAttribute(TokenAuthFilter.ATTR) AuthUser user) {
        requireModerator(id, user);
        muteService.unmute(id, userId);
        return ApiResponse.ok(null);
    }
}
