package com.livedemo.live.chat;

import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class ChatService {

    static final int HISTORY_MAX = 50;

    private final Map<Long, Deque<ChatMessage>> historyByRoom = new ConcurrentHashMap<>();

    public List<ChatMessage> history(long roomId) {
        Deque<ChatMessage> deque = historyByRoom.get(roomId);
        if (deque == null) return List.of();
        synchronized (deque) {
            return List.copyOf(deque);
        }
    }

    public ChatMessage append(long roomId, String userId, String nickname, String content) {
        ChatMessage message = new ChatMessage(UUID.randomUUID().toString(), userId, nickname, content,
                System.currentTimeMillis());
        Deque<ChatMessage> deque = historyByRoom.computeIfAbsent(roomId, k -> new ArrayDeque<>());
        synchronized (deque) {
            deque.addLast(message);
            while (deque.size() > HISTORY_MAX) deque.pollFirst();
        }
        return message;
    }

    /** 主播/管理员删弹幕用；返回是否找到并删除 */
    public boolean removeMessage(long roomId, String messageId) {
        Deque<ChatMessage> deque = historyByRoom.get(roomId);
        if (deque == null) return false;
        synchronized (deque) {
            for (Iterator<ChatMessage> it = deque.iterator(); it.hasNext(); ) {
                if (it.next().messageId().equals(messageId)) {
                    it.remove();
                    return true;
                }
            }
        }
        return false;
    }
}
