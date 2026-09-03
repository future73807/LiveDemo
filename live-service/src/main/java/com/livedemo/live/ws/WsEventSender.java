package com.livedemo.live.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Slf4j
@Component
@RequiredArgsConstructor
public class WsEventSender {

    private final RoomSessionRegistry registry;
    private final ObjectMapper om;

    public void send(WebSocketSession session, Object payload) {
        try {
            session.sendMessage(new TextMessage(om.writeValueAsString(payload)));
        } catch (Exception e) {
            log.warn("WS 发送失败: {}", e.getMessage());
        }
    }

    public void broadcast(long roomId, Object payload) {
        String json = toJson(payload);
        registry.sessions(roomId).forEach(info -> {
            try {
                synchronized (info.session()) {
                    info.session().sendMessage(new TextMessage(json));
                }
            } catch (Exception e) {
                log.warn("WS 广播失败: {}", e.getMessage());
            }
        });
    }

    public void broadcastPresence(long roomId) {
        broadcast(roomId, java.util.Map.of(
                "type", "presence",
                "viewers", registry.viewers(roomId),
                "users", registry.nicknames(roomId)));
    }

    private String toJson(Object payload) {
        try { return om.writeValueAsString(payload); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
