package com.livedemo.live.auth;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/** internal 模式用户：userId 即登录名（demo 语义）；封禁复用 banned_user 表，不在此重复 */
@Entity
@Table(name = "users")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class UserAccount {
    @Id
    @Column(name = "user_id", length = 64)
    private String userId;

    @Column(nullable = false, length = 100)
    private String password;        // BCrypt hash

    @Column(nullable = false, length = 64)
    private String nickname;

    @Column(nullable = false, length = 16)
    private String role;            // VIEWER / HOST / ADMIN

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
