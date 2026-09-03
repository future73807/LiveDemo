package com.livedemo.live.safety;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 房间级禁言：内存态，随房间生命周期（设计 §5.6） */
@Component
public class MuteService {

    private final Map<Long, Map<String, Long>> mutes = new ConcurrentHashMap<>();

    public void mute(long roomId, String userId, long durationSec) {
        mutes.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>())
                .put(userId, System.currentTimeMillis() + durationSec * 1000);
    }

    public void unmute(long roomId, String userId) {
        Map<String, Long> room = mutes.get(roomId);
        if (room != null) room.remove(userId);
    }

    public long remainingSec(long roomId, String userId) {
        Map<String, Long> room = mutes.get(roomId);
        if (room == null) return 0;
        Long until = room.get(userId);
        if (until == null) return 0;
        long remain = (until - System.currentTimeMillis()) / 1000;
        if (remain <= 0) {
            room.remove(userId);
            return 0;
        }
        return remain;
    }

    public void clearRoom(long roomId) { mutes.remove(roomId); }
}
