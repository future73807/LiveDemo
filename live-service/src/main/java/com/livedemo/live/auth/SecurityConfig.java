package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import com.livedemo.live.safety.BanService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import java.util.List;
import java.util.Map;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final List<AuthProvider> providers;
    private final LiveProps props;
    private final ObjectMapper om;
    private final BanService banService;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/rooms", "/api/rooms/*", "/api/rooms/*/play-urls", "/api/rooms/*/products").permitAll()
                .requestMatchers("/api/auth/**", "/api/v1/srs/hooks", "/ws").permitAll()
                .anyRequest().authenticated())
            .exceptionHandling(e -> e
                .authenticationEntryPoint((req, res, ex) -> write(res, 401, "未认证"))
                .accessDeniedHandler((req, res, ex) -> write(res, 403, "权限不足")))
            .addFilterBefore(new TokenAuthFilter(providers,
                            AuthMode.valueOf(props.getAuth().getMode().toUpperCase()), banService),
                    UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private void write(HttpServletResponse res, int status, String message) throws java.io.IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write(om.writeValueAsString(Map.of("code", String.valueOf(status), "message", message)));
    }
}
