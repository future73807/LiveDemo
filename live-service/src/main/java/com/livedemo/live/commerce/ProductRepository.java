package com.livedemo.live.commerce;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ProductRepository extends JpaRepository<Product, Long> {
    List<Product> findByOwnerIdOrderByIdDesc(String ownerId);
}
