package com.livedemo.live.room;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoomRepository extends JpaRepository<Room, Long> {
    Optional<Room> findByStreamKey(String streamKey);
    List<Room> findByStatus(RoomStatus status);
}
