package com.livedemo.live.commerce.local;

import com.livedemo.live.common.BusinessException;
import com.livedemo.live.commerce.*;
import com.livedemo.live.commerce.acl.CartEntry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class LocalCartServiceTest {

    private final ProductRepository productRepo = mock(ProductRepository.class);
    private final CartItemRepository cartRepo = mock(CartItemRepository.class);
    private final RoomProductRepository shelfRepo = mock(RoomProductRepository.class);
    private final LocalCartService service = new LocalCartService(productRepo, cartRepo, shelfRepo);

    private Product product(long id) {
        return Product.builder().id(id).ownerId("h1").title("商品" + id)
                .price(BigDecimal.valueOf(9.9)).build();
    }

    @Test
    void add_newProduct_createsItem() {
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1)));
        when(cartRepo.findByUserIdAndProductId("u1", 1L)).thenReturn(Optional.empty());
        when(cartRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        CartEntry entry = service.add("u1", 1L, 2, null);
        assertThat(entry.qty()).isEqualTo(2);
        assertThat(entry.title()).isEqualTo("商品1");
    }

    @Test
    void add_existingProduct_accumulatesQty() {
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1)));
        CartItem existing = CartItem.builder().id(7L).userId("u1").productId(1L).qty(1).build();
        when(cartRepo.findByUserIdAndProductId("u1", 1L)).thenReturn(Optional.of(existing));
        when(cartRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        CartEntry entry = service.add("u1", 1L, 2, null);
        assertThat(entry.itemId()).isEqualTo(7L);
        assertThat(entry.qty()).isEqualTo(3);
    }

    @Test
    void add_withRoomId_removedFromShelf_returns400() {
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1)));
        RoomProduct removed = RoomProduct.builder().roomId(5L).productId(1L)
                .removedAt(java.time.LocalDateTime.now()).build();
        when(shelfRepo.findByRoomIdAndProductId(5L, 1L)).thenReturn(Optional.of(removed));

        assertThatThrownBy(() -> service.add("u1", 1L, 1, 5L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getStatus()).isEqualTo(400);
        verify(cartRepo, never()).save(any());
    }

    @Test
    void add_unknownProduct_returns404() {
        when(productRepo.findById(9L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.add("u1", 9L, 1, null))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getStatus()).isEqualTo(404);
    }

    @Test
    void updateQty_ownedItemOnly() {
        CartItem item = CartItem.builder().id(7L).userId("u1").productId(1L).qty(1).build();
        when(cartRepo.findByIdAndUserId(7L, "u1")).thenReturn(Optional.of(item));
        when(productRepo.findById(1L)).thenReturn(Optional.of(product(1)));
        when(cartRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        assertThat(service.updateQty("u1", 7L, 5).qty()).isEqualTo(5);

        when(cartRepo.findByIdAndUserId(7L, "u2")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.updateQty("u2", 7L, 1))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getStatus()).isEqualTo(404);
    }

    @Test
    void remove_ownedItemOnly() {
        when(cartRepo.existsByIdAndUserId(7L, "u1")).thenReturn(true);
        service.remove("u1", 7L);
        verify(cartRepo).deleteById(7L);

        when(cartRepo.existsByIdAndUserId(7L, "u2")).thenReturn(false);
        assertThatThrownBy(() -> service.remove("u2", 7L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getStatus()).isEqualTo(404);
    }
}
