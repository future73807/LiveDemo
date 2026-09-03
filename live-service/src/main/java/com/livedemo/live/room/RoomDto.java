package com.livedemo.live.room;

import java.time.LocalDateTime;

public record RoomDto(Long id, String title, String ownerId, String ownerName,
                      String streamKey, String pushUrl, RoomStatus status,
                      int viewerCount, int productCount, LocalDateTime createdAt) {

    public static RoomDto of(Room r, String pushUrl, boolean includeKey, int viewers, int productCount) {
        return new RoomDto(r.getId(), r.getTitle(), r.getOwnerId(), r.getOwnerName(),
                includeKey ? r.getStreamKey() : null, pushUrl, r.getStatus(), viewers, productCount, r.getCreatedAt());
    }
}
