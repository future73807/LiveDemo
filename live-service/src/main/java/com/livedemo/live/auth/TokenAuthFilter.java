package com.livedemo.live.auth;

import com.livedemo.live.safety.BanService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@RequiredArgsConstructor
public class TokenAuthFilter extends OncePerRequestFilter {

    public static final String ATTR = "authUser";

    private final List<AuthProvider> providers;
    private final AuthMode mode;
    private final BanService banService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String credential = extract(request);
        if (credential != null) {
            // gateway 模式信任反代注入的头；internal/jwt 一律走 JWT 验签（internal 自签发 JWT 复用同一验签链）
            AuthProvider provider = providers.stream()
                    .filter(p -> mode == AuthMode.GATEWAY_HEADER
                            ? p.mode() == AuthMode.GATEWAY_HEADER
                            : p.mode() == AuthMode.JWT)
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException("未找到 mode=" + mode + " 对应的 AuthProvider"));
            try {
                AuthUser user = provider.authenticate(credential);
                if (banService.isBanned(user.userId())) {
                    response.setStatus(403);
                    response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"code\":\"403\",\"message\":\"账号已被封禁\"}");
                    return;
                }
                request.setAttribute(ATTR, user);
                // 同步写入 SecurityContext，供 authorizeHttpRequests 的 anyRequest().authenticated() 判定
                var authorities = user.roles().stream()
                        .map(r -> new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_" + r))
                        .toList();
                var authentication = new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                        user, null, authorities);
                org.springframework.security.core.context.SecurityContextHolder.getContext()
                        .setAuthentication(authentication);
            } catch (InvalidTokenException e) {
                response.setStatus(401);
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"code\":\"401\",\"message\":\"" + e.getMessage() + "\"}");
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private String extract(HttpServletRequest request) {
        if (mode == AuthMode.GATEWAY_HEADER) {
            String userId = request.getHeader("X-User-Id");
            if (userId == null || userId.isBlank()) return null;
            return String.join("|", userId,
                    request.getHeader("X-User-Name") == null ? "" : request.getHeader("X-User-Name"),
                    request.getHeader("X-User-Roles") == null ? "" : request.getHeader("X-User-Roles"));
        }
        String auth = request.getHeader("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) return null;
        return auth.substring(7).trim();
    }
}
