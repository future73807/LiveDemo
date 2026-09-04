package com.livedemo.live.auth;

import com.livedemo.live.config.LiveProps;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/** internal 模式下按环境变量引导创建管理员（不开放注册） */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "live.auth.mode", havingValue = "internal")
public class AdminUserInitializer implements CommandLineRunner {

    private final UserAccountRepository users;
    private final PasswordEncoder encoder;
    private final LiveProps props;

    @Override
    public void run(String... args) {
        String username = props.getAuth().getAdminUsername();
        String password = props.getAuth().getAdminPassword();
        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            log.warn("未配置 live.auth.admin-username/password，跳过管理员引导");
            return;
        }
        if (users.existsById(username)) return;
        users.save(UserAccount.builder()
                .userId(username)
                .password(encoder.encode(password))
                .nickname("管理员")
                .role(AuthUser.ADMIN)
                .createdAt(LocalDateTime.now())
                .build());
        log.info("已创建管理员账号: {}", username);
    }
}
