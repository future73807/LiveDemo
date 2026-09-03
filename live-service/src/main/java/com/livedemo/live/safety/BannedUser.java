package com.livedemo.live.safety;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "banned_user")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class BannedUser {
    @Id
    @Column(name = "user_id", length = 64)
    private String userId;

    @Column(length = 255)
    private String reason;

    @Column(name = "banned_at", nullable = false)
    private LocalDateTime bannedAt;
}
