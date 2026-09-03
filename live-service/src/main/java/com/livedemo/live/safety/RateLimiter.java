package com.livedemo.live.safety;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 单连接每秒发言上限（设计 §5.5：5 条/秒），按 key（userId）计数 */
@Component
public class RateLimiter {

    private record Window(long second, int count) {}

    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public boolean allow(String key, int limitPerSecond) {
        long now = System.currentTimeMillis() / 1000;
        Window w = windows.compute(key, (k, old) -> {
            if (old == null || old.second() != now) return new Window(now, 1);
            return new Window(now, old.count() + 1);   // 拒绝同样累计，保证 count 能超过 limit
        });
        return w.count() <= limitPerSecond;
    }

    /** 连接关闭时清理，防内存泄漏 */
    public void evict(String key) { windows.remove(key); }
}
