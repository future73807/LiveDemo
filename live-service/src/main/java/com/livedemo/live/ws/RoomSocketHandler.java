package com.livedemo.live.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.livedemo.live.chat.ChatMessage;
import com.livedemo.live.chat.ChatService;
import com.livedemo.live.safety.MuteService;
import com.livedemo.live.safety.RateLimiter;
import com.livedemo.live.safety.SensitiveWordFilter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class RoomSocketHandler extends TextWebSocketHandler {

    public static final String ATTR_ROOM_ID = "roomId";
    public static final String ATTR_USER_ID = "userId";
    public static final String ATTR_NICKNAME = "nickname";

    private final RoomSessionRegistry registry;
    private final WsEventSender sender;
    private final ChatService chatService;
    private final ObjectMapper om;
    private final MuteService muteService;
    private final RateLimiter rateLimiter;
    private final SensitiveWordFilter wordFilter;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        long roomId = roomId(session);
        registry.add(roomId, new RoomSessionRegistry.SessionInfo(session,
                (String) session.getAttributes().get(ATTR_USER_ID),
                (String) session.getAttributes().get(ATTR_NICKNAME)));
        sender.send(session, Map.of("type", "history", "messages", chatService.history(roomId)));
        sender.broadcastPresence(roomId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        long roomId = roomId(session);
        String userId = (String) session.getAttributes().get(ATTR_USER_ID);
        String nickname = (String) session.getAttributes().get(ATTR_NICKNAME);
        try {
            JsonNode node = om.readTree(message.getPayload());
            if (!"chat".equals(node.path("type").asText())) return;
            String content = node.path("content").asText("").trim();
            if (content.isEmpty()) return;

            // 1. 房间级禁言
            long remain = muteService.remainingSec(roomId, userId);
            if (remain > 0) {
                sender.send(session, Map.of("type", "error", "code", "E_MUTED",
                        "message", "已被禁言", "durationSec", remain));
                return;
            }
            // 2. 频控（设计 §5.5：5 条/秒）
            if (!rateLimiter.allow(userId, 5)) {
                sender.send(session, Map.of("type", "error", "code", "E_RATE_LIMITED",
                        "message", "发言过于频繁"));
                return;
            }
            // 3. 敏感词（设计 §5.6：replace=掩码放行，reject=拒绝）
            SensitiveWordFilter.SafetyResult safety = wordFilter.check(content);
            if (safety.blocked() && wordFilter.isRejectMode()) {
                sender.send(session, Map.of("type", "error", "code", "E_SENSITIVE",
                        "message", "消息包含敏感内容"));
                return;
            }
            content = safety.content();

            ChatMessage msg = chatService.append(roomId, userId, nickname, content);
            sender.broadcast(roomId, Map.of(
                    "type", "chat",
                    "messageId", msg.messageId(),
                    "userId", msg.userId(),
                    "nickname", msg.nickname(),
                    "content", msg.content(),
                    "ts", msg.ts()));
            sender.broadcastPresence(roomId);
        } catch (Exception e) {
            log.warn("WS 消息处理失败: {}", e.getMessage());
            sender.send(session, Map.of("type", "error", "code", "E_FORMAT", "message", "消息格式错误"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        long roomId = roomId(session);
        registry.remove(roomId, session);
        rateLimiter.evict((String) session.getAttributes().get(ATTR_USER_ID));   // 防内存泄漏
        sender.broadcastPresence(roomId);
    }

    private long roomId(WebSocketSession session) {
        return ((Number) session.getAttributes().get(ATTR_ROOM_ID)).longValue();
    }
}
