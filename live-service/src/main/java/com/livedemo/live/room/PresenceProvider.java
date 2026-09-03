package com.livedemo.live.room;

import java.util.List;

/** 在线人数来源，由 ws 层实现（Task 6）；无实现时按 0 人处理 */
public interface PresenceProvider {
    int viewers(long roomId);
    List<String> nicknames(long roomId);
}
