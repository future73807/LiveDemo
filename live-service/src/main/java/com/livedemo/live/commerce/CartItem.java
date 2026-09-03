package com.livedemo.live.commerce;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "cart_item", uniqueConstraints = @UniqueConstraint(name = "uk_user_product", columnNames = {"user_id", "product_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class CartItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    @Column(name = "product_id", nullable = false)
    private Long productId;

    @Column(nullable = false)
    @Builder.Default
    private int qty = 1;
}
