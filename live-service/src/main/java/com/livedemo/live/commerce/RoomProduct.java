package com.livedemo.live.commerce;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "room_product", uniqueConstraints = @UniqueConstraint(name = "uk_room_product", columnNames = {"room_id", "product_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class RoomProduct {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "room_id", nullable = false)
    private Long roomId;

    @Column(name = "product_id", nullable = false)
    private Long productId;

    @Column(nullable = false)
    @Builder.Default
    private int sort = 0;

    @Column(name = "added_at", nullable = false)
    private LocalDateTime addedAt;

    /** 摘除 = 软删（设计 §5.1） */
    @Column(name = "removed_at")
    private LocalDateTime removedAt;

    public boolean isActive() { return removedAt == null; }
}
