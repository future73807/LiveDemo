package com.livedemo.live.ws;

import com.livedemo.live.auth.AuthMode;
import com.livedemo.live.auth.AuthProvider;
import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.auth.InvalidTokenException;
import com.livedemo.live.config.LiveProps;
import com.livedemo.live.safety.BanService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.List;
import java.util.Map;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WsConfig implements WebSocketConfigurer {

    private final RoomSocketHandler handler;
    private final List<AuthProvider> providers;
    private final LiveProps props;
    private final BanService banService;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws")
                .addInterceptors(new AuthHandshakeInterceptor())
                .setAllowedOriginPatterns("*");
    }

    /** 浏览器原生 WebSocket 无法带自定义头：JWT 走 token 查询参数；gateway 模式信任反代注入的头 */
    class AuthHandshakeInterceptor implements HandshakeInterceptor {
        @Override
        public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                       WebSocketHandler wsHandler, Map<String, Object> attributes) {
            if (!(request instanceof ServletServerHttpRequest servlet)) return false;
            var req = servlet.getServletRequest();
            long roomId;
            try {
                roomId = Long.parseLong(req.getParameter("roomId"));
            } catch (Exception e) {
                return false;
            }
            AuthUser user;
            if (props.getAuth().getMode().equalsIgnoreCase("gateway")) {
                String userId = req.getHeader("X-User-Id");
                if (userId == null || userId.isBlank()) return false;
                user = new AuthUser(userId,
                        req.getHeader("X-User-Name") == null ? userId : req.getHeader("X-User-Name"),
                        AuthUser.rolesOf(req.getHeader("X-User-Roles")));
            } else {
                String token = req.getParameter("token");
                if (token == null || token.isBlank()) return false;
                AuthProvider provider = providers.stream()
                        .filter(p -> p.mode() == AuthMode.JWT).findFirst().orElseThrow();
                try {
                    user = provider.authenticate(token);
                } catch (InvalidTokenException e) {
                    return false;
                }
            }
            attributes.put(RoomSocketHandler.ATTR_ROOM_ID, roomId);
            attributes.put(RoomSocketHandler.ATTR_USER_ID, user.userId());
            attributes.put(RoomSocketHandler.ATTR_NICKNAME, user.nickname());
            if (banService.isBanned(user.userId())) return false;   // 封禁用户拒绝握手
            return true;
        }

        @Override
        public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Exception exception) {}
    }
}
