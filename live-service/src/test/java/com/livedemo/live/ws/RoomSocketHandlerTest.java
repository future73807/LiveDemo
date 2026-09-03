package com.livedemo.live.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.livedemo.live.chat.ChatService;
import com.livedemo.live.safety.MuteService;
import com.livedemo.live.safety.RateLimiter;
import com.livedemo.live.safety.SensitiveWordFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.net.URI;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RoomSocketHandlerTest {

    private RoomSessionRegistry registry;
    private WsEventSender sender;
    private ChatService chatService;
    private MuteService muteService;
    private RateLimiter rateLimiter;
    private SensitiveWordFilter wordFilter;
    private RoomSocketHandler handler;

    private final ObjectMapper om = new ObjectMapper();

    @BeforeEach
    void setUp() {
        registry = new RoomSessionRegistry();
        sender = new WsEventSender(registry, om);
        chatService = new ChatService();
        muteService = mock(MuteService.class);
        rateLimiter = new RateLimiter();
        wordFilter = mock(SensitiveWordFilter.class);
        when(wordFilter.check(any())).thenAnswer(inv ->
                new SensitiveWordFilter.SafetyResult(false, inv.getArgument(0)));
        handler = new RoomSocketHandler(registry, sender, chatService, om, muteService, rateLimiter, wordFilter);
    }

    private WebSocketSession session(String id, long roomId, String userId) throws Exception {
        WebSocketSession s = mock(WebSocketSession.class);
        when(s.getId()).thenReturn(id);
        when(s.isOpen()).thenReturn(true);
        when(s.getAttributes()).thenReturn(Map.of(
                RoomSocketHandler.ATTR_ROOM_ID, roomId,
                RoomSocketHandler.ATTR_USER_ID, userId,
                RoomSocketHandler.ATTR_NICKNAME, "nick-" + userId));
        when(s.getUri()).thenReturn(new URI("ws://localhost/ws?roomId=" + roomId));
        return s;
    }

    /**
     * 捕获 session 收到的全部文本帧并返回最后一帧。
     * 注意：afterConnectionEstablished 会先发 history/presence，错误帧在其后，
     * 因此必须用 getAllValues() 取末尾，而不是仅看某一次调用。
     */
    private String lastFrame(WebSocketSession s) throws Exception {
        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
        verify(s, atLeastOnce()).sendMessage(captor.capture());
        List<TextMessage> all = captor.getAllValues();
        return all.get(all.size() - 1).getPayload();
    }

    @Test
    void mutedUserGetsErrorAndMessageDropped() throws Exception {
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);
        when(muteService.remainingSec(1L, "u1")).thenReturn(30L);

        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"hi\"}"));

        assertThat(lastFrame(s)).contains("\"E_MUTED\"");
        assertThat(chatService.history(1L)).isEmpty();
    }

    @Test
    void overRateLimitGetsError() throws Exception {
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);
        for (int i = 0; i < 5; i++) {
            handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"m" + i + "\"}"));
        }
        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"m5\"}"));
        assertThat(lastFrame(s)).contains("\"E_RATE_LIMITED\"");
        assertThat(chatService.history(1L)).hasSize(5);
    }

    @Test
    void sensitiveHitInRejectModeIsBlocked() throws Exception {
        when(wordFilter.check(any())).thenReturn(new SensitiveWordFilter.SafetyResult(true, "***"));
        when(wordFilter.isRejectMode()).thenReturn(true);
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);

        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"forbidden-info\"}"));

        assertThat(lastFrame(s)).contains("\"E_SENSITIVE\"");
        assertThat(chatService.history(1L)).isEmpty();
    }

    @Test
    void sensitiveHitInReplaceModeIsMasked() throws Exception {
        when(wordFilter.check(any())).thenReturn(new SensitiveWordFilter.SafetyResult(true, "masked**content"));
        when(wordFilter.isRejectMode()).thenReturn(false);
        WebSocketSession s = session("s1", 1L, "u1");
        handler.afterConnectionEstablished(s);

        handler.handleTextMessage(s, new TextMessage("{\"type\":\"chat\",\"content\":\"sensitive-content\"}"));

        assertThat(chatService.history(1L).get(0).content()).isEqualTo("masked**content");
    }
}
