package com.livedemo.live.commerce;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.room.RoomService;
import com.livedemo.live.ws.WsEventSender;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class ShelfServiceTest {

    private final RoomProductRepository shelfRepo = mock(RoomProductRepository.class);
    private final ProductRepository productRepo = mock(ProductRepository.class);
    private final RoomService roomService = mock(RoomService.class);
    private final WsEventSender sender = mock(WsEventSender.class);
    private final ShelfService service = new ShelfService(shelfRepo, productRepo, roomService, sender);

    private final AuthUser host = new AuthUser("h1", "主播甲", java.util.Set.of("HOST"));

    private void ownedRoom() {
        com.livedemo.live.room.Room room = com.livedemo.live.room.Room.builder()
                .id(5L).ownerId("h1").streamKey("room-abc").build();
        when(roomService.get(5L)).thenReturn(room);
    }

    private Product product(long id, String owner) {
        return Product.builder().id(id).ownerId(owner).title("商品" + id)
                .price(BigDecimal.TEN).build();
    }

    @Test
    void mount_savesActiveAndBroadcasts() {
        ownedRoom();
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1L, "h1")));
        when(shelfRepo.findByRoomIdAndProductId(5L, 1L)).thenReturn(Optional.empty());
        when(shelfRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.mount(5L, 1L, 0, host);

        ArgumentCaptor<RoomProduct> captor = ArgumentCaptor.forClass(RoomProduct.class);
        verify(shelfRepo).save(captor.capture());
        assertThat(captor.getValue().isActive()).isTrue();
        verify(sender).broadcast(eq(5L), any());
    }

    @Test
    void mount_platformProductByAnyHost_succeeds() {
        ownedRoom();
        // 平台库商品（owner=platform）：任意主播均可挂载（M9 平台商品库语义）
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1L, "platform")));
        when(shelfRepo.findByRoomIdAndProductId(5L, 1L)).thenReturn(Optional.empty());
        when(shelfRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.mount(5L, 1L, 0, host);

        ArgumentCaptor<RoomProduct> captor = ArgumentCaptor.forClass(RoomProduct.class);
        verify(shelfRepo).save(captor.capture());
        assertThat(captor.getValue().isActive()).isTrue();
        verify(sender).broadcast(eq(5L), any());
    }

    @Test
    void mount_twice_returns400() {
        ownedRoom();
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1L, "h1")));
        when(shelfRepo.findByRoomIdAndProductId(5L, 1L))
                .thenReturn(Optional.of(RoomProduct.builder().roomId(5L).productId(1L).build()));
        assertThatThrownBy(() -> service.mount(5L, 1L, 0, host))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getStatus()).isEqualTo(400);
    }

    @Test
    void unmount_softDeletesAndBroadcasts() {
        ownedRoom();
        RoomProduct mounted = RoomProduct.builder().id(1L).roomId(5L).productId(1L).build();
        when(shelfRepo.findByRoomIdAndProductId(5L, 1L)).thenReturn(Optional.of(mounted));
        when(shelfRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        // 计划笔误修复：实现里通过 productRepo.findById 取商品信息后广播，需补 stub 否则 Optional 默认为空、广播不触发
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1L, "h1")));

        service.unmount(5L, 1L, host);

        ArgumentCaptor<RoomProduct> captor = ArgumentCaptor.forClass(RoomProduct.class);
        verify(shelfRepo).save(captor.capture());
        assertThat(captor.getValue().isActive()).isFalse();
        verify(sender).broadcast(eq(5L), any());
    }

    @Test
    void mount_notOwnerOfRoom_returns403() {
        com.livedemo.live.room.Room room = com.livedemo.live.room.Room.builder()
                .id(5L).ownerId("other").streamKey("room-abc").build();
        when(roomService.get(5L)).thenReturn(room);
        assertThatThrownBy(() -> service.mount(5L, 1L, 0, host))
                .isInstanceOf(BusinessException.class);
    }
}
