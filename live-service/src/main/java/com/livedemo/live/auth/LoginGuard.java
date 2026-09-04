package com.livedemo.live.auth;

import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 登录防撞库：per-IP 60 秒窗口最多 10 次 */
@Component
public class LoginGuard {

    static final int LIMIT = 10;
    static final long WINDOW_MS = 60_000;

    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public boolean allow(String ip) { return allow(ip, System.currentTimeMillis()); }

    boolean allow(String ip, long now) {
        Deque<Long> deque = hits.computeIfAbsent(ip, k -> new ArrayDeque<>());
        synchronized (deque) {
            for (Iterator<Long> it = deque.iterator(); it.hasNext(); ) {
                if (now - it.next() > WINDOW_MS) it.remove();
            }
            if (deque.size() >= LIMIT) return false;
            deque.addLast(now);
            return true;
        }
    }
}
