package com.livedemo.live.commerce;

import com.livedemo.live.auth.AuthUser;
import com.livedemo.live.common.BusinessException;
import com.livedemo.live.room.RoomService;
import com.livedemo.live.room.ShelfCountProvider;
import com.livedemo.live.ws.WsEventSender;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ShelfService implements ShelfCountProvider {

    private final RoomProductRepository shelfRepo;
    private final ProductRepository productRepo;
    private final RoomService roomService;
    private final WsEventSender sender;

    public List<Map<String, Object>> listActive(long roomId) {
        return shelfRepo.findByRoomIdAndRemovedAtIsNullOrderBySortAscIdAsc(roomId).stream()
                .map(mount -> productRepo.findById(mount.getProductId()).orElse(null))
                .filter(p -> p != null)
                .map(this::toMap)
                .toList();
    }

    public void mount(long roomId, long productId, int sort, AuthUser user) {
        roomService.assertOwner(roomService.get(roomId), user);
        Product product = productRepo.findById(productId)
                .orElseThrow(() -> BusinessException.notFound("商品不存在"));
        RoomProduct mount = shelfRepo.findByRoomIdAndProductId(roomId, productId).orElse(null);
        if (mount != null && mount.isActive()) {
            throw BusinessException.badRequest("商品已挂载");
        }
        if (mount == null) {
            mount = RoomProduct.builder().roomId(roomId).productId(productId).addedAt(LocalDateTime.now()).build();
        } else {
            mount.setRemovedAt(null);   // 重新上架
        }
        mount.setSort(sort);
        shelfRepo.save(mount);
        broadcast(roomId, "add", product);
    }

    public void unmount(long roomId, long productId, AuthUser user) {
        roomService.assertOwner(roomService.get(roomId), user);
        RoomProduct mount = shelfRepo.findByRoomIdAndProductId(roomId, productId)
                .filter(RoomProduct::isActive)
                .orElseThrow(() -> BusinessException.notFound("商品未在货架上"));
        mount.setRemovedAt(LocalDateTime.now());
        shelfRepo.save(mount);
        productRepo.findById(productId).ifPresent(p -> broadcast(roomId, "remove", p));
    }

    /** 平台删除商品时级联软删所有在架挂载，并逐房间广播下架事件 */
    public int unmountAll(long productId) {
        var actives = shelfRepo.findByProductIdAndRemovedAtIsNull(productId);
        actives.forEach(mount -> {
            mount.setRemovedAt(java.time.LocalDateTime.now());
            shelfRepo.save(mount);
            productRepo.findById(productId).ifPresent(p -> broadcast(mount.getRoomId(), "remove", p));
        });
        return actives.size();
    }

    @Override
    public int activeCount(long roomId) {
        return (int) shelfRepo.countByRoomIdAndRemovedAtIsNull(roomId);
    }

    private void broadcast(long roomId, String action, Product product) {
        sender.broadcast(roomId, Map.of("type", "product_update", "action", action, "product", toMap(product)));
    }

    private Map<String, Object> toMap(Product p) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", p.getId());
        map.put("title", p.getTitle());
        map.put("price", p.getPrice());
        map.put("imageUrl", p.getImageUrl());
        map.put("detailUrl", p.getDetailUrl());
        return map;
    }
}
