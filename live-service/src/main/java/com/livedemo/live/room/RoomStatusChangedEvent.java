package com.livedemo.live.room;

public record RoomStatusChangedEvent(Long roomId, RoomStatus status) {}
