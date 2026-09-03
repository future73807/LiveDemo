package com.livedemo.live.ws;

import com.livedemo.live.room.RoomStatusChangedEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
@RequiredArgsConstructor
public class RoomStatusListener {

    private final WsEventSender sender;

    @EventListener
    public void on(RoomStatusChangedEvent event) {
        sender.broadcast(event.roomId(), Map.of("type", "room_status", "status", event.status().name()));
    }
}
