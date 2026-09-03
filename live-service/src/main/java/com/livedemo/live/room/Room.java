package com.livedemo.live.room;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "room")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Room {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String title;

    @Column(name = "owner_id", nullable = false, length = 64)
    private String ownerId;

    @Column(name = "owner_name", nullable = false, length = 64)
    private String ownerName;

    @Column(name = "stream_key", nullable = false, unique = true, length = 64)
    private String streamKey;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    @Builder.Default
    private RoomStatus status = RoomStatus.IDLE;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
