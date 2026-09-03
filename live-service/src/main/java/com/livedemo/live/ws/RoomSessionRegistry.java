package com.livedemo.live.ws;

import com.livedemo.live.room.PresenceProvider;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class RoomSessionRegistry implements PresenceProvider {

    private final Map<Long, List<SessionInfo>> byRoom = new ConcurrentHashMap<>();
    private final Map<String, List<SessionInfo>> byUser = new ConcurrentHashMap<>();

    public record SessionInfo(WebSocketSession session, String userId, String nickname) {}

    public void add(long roomId, SessionInfo info) {
        byRoom.computeIfAbsent(roomId, k -> new CopyOnWriteArrayList<>()).add(info);
        byUser.computeIfAbsent(info.userId(), k -> new CopyOnWriteArrayList<>()).add(info);
    }

    public void remove(long roomId, WebSocketSession session) {
        var list = byRoom.get(roomId);
        if (list != null) list.removeIf(info -> info.session().getId().equals(session.getId()));
        byUser.values().forEach(l -> l.removeIf(info -> info.session().getId().equals(session.getId())));
    }

    public List<SessionInfo> sessions(long roomId) {
        var list = byRoom.get(roomId);
        if (list == null) return List.of();
        return list.stream().filter(i -> i.session().isOpen()).toList();
    }

    /** 平台封禁：踢掉该用户全部连接 */
    public List<SessionInfo> closeAllOf(String userId) {
        var list = byUser.getOrDefault(userId, List.of());
        list.forEach(info -> {
            try { info.session().close(); } catch (Exception ignored) {}
        });
        return list;
    }

    @Override
    public int viewers(long roomId) { return sessions(roomId).size(); }

    @Override
    public List<String> nicknames(long roomId) {
        return sessions(roomId).stream().map(SessionInfo::nickname).toList();
    }
}
