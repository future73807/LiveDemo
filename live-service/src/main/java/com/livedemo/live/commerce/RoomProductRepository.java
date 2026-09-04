package com.livedemo.live.commerce;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoomProductRepository extends JpaRepository<RoomProduct, Long> {
    List<RoomProduct> findByRoomIdAndRemovedAtIsNullOrderBySortAscIdAsc(Long roomId);
    Optional<RoomProduct> findByRoomIdAndProductId(Long roomId, Long productId);
    List<RoomProduct> findByProductIdAndRemovedAtIsNull(Long productId);
    long countByRoomIdAndRemovedAtIsNull(Long roomId);
}
