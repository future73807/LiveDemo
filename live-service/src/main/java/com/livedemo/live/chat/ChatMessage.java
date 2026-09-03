package com.livedemo.live.chat;

public record ChatMessage(String messageId, String userId, String nickname, String content, long ts) {}
