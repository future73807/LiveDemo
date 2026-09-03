package com.livedemo.live.chat;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ChatServiceTest {

    private final ChatService service = new ChatService();

    @Test
    void history_keepsNewest50() {
        for (int i = 1; i <= 60; i++) {
            service.append(1L, "u1", "n", "msg-" + i);
        }
        List<ChatMessage> history = service.history(1L);
        assertThat(history).hasSize(50);
        assertThat(history.get(0).content()).isEqualTo("msg-11");   // 最早的被淘汰
        assertThat(history.get(49).content()).isEqualTo("msg-60");  // 最新在尾部
    }

    @Test
    void append_assignsUniqueIds() {
        ChatMessage a = service.append(1L, "u1", "n", "a");
        ChatMessage b = service.append(1L, "u1", "n", "b");
        assertThat(a.messageId()).isNotEqualTo(b.messageId());
    }

    @Test
    void rooms_areIsolated() {
        service.append(1L, "u1", "n", "a");
        assertThat(service.history(2L)).isEmpty();
    }

    @Test
    void removeMessage_deletesFromHistory() {
        ChatMessage m = service.append(1L, "u1", "n", "bad");
        assertThat(service.removeMessage(1L, m.messageId())).isTrue();
        assertThat(service.history(1L)).isEmpty();
        assertThat(service.removeMessage(1L, "nope")).isFalse();
    }
}
