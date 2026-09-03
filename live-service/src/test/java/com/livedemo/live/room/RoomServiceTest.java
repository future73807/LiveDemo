package com.livedemo.live.room;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.config.LiveProps;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationEventPublisher;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RoomServiceTest {

    private final RoomRepository repo = mock(RoomRepository.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<PresenceProvider> presence = mock(ObjectProvider.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final RoomService service = new RoomService(repo, presence, events, new LiveProps());

    private final AuthUser host = new AuthUser("u1", "主播甲", java.util.Set.of("HOST"));

    @Test
    void create_generatesStreamKeyAndSavesIdle() {
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        Room room = service.create("测试直播间", host);
        assertThat(room.getStreamKey()).matches("room-[0-9a-f]{8}");
        assertThat(room.getStatus()).isEqualTo(RoomStatus.IDLE);
        assertThat(room.getOwnerId()).isEqualTo("u1");
    }

    @Test
    void markLiving_unknownKey_throws403() {
        when(repo.findByStreamKey("bad")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.markLiving("bad"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getStatus()).isEqualTo(403);
        verify(repo, never()).save(any());
    }

    @Test
    void markLiving_setsLivingAndPublishesEvent() {
        Room room = new Room(); room.setId(1L); room.setStreamKey("room-abc"); room.setStatus(RoomStatus.IDLE);
        when(repo.findByStreamKey("room-abc")).thenReturn(Optional.of(room));
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service.markLiving("room-abc");
        ArgumentCaptor<Room> captor = ArgumentCaptor.forClass(Room.class);
        verify(repo).save(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo(RoomStatus.LIVING);
    }

    @Test
    void markIdle_setsIdle() {
        Room room = new Room(); room.setId(1L); room.setStreamKey("room-abc"); room.setStatus(RoomStatus.LIVING);
        when(repo.findByStreamKey("room-abc")).thenReturn(Optional.of(room));
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service.markIdle("room-abc");
        verify(repo).save(argThat(r -> r.getStatus() == RoomStatus.IDLE));
    }

    @Test
    void end_requiresOwner() {
        Room room = new Room(); room.setId(1L); room.setOwnerId("u9");
        when(repo.findById(1L)).thenReturn(Optional.of(room));
        assertThatThrownBy(() -> service.end(1L, host))
                .isInstanceOf(BusinessException.class);
    }
}
