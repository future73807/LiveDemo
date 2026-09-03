import { http } from './client';
import type { CartEntry, PlayUrls, Product, Room } from './types';

export const authApi = {
  devToken: (userId: string, nickname: string, roles: string[]) =>
    http.post<{ token: string; expiresIn: number }>('/auth/dev-token', { userId, nickname, roles })
};

export const roomsApi = {
  list: (status?: 'LIVING') => http.get<Room[]>(`/rooms${status ? `?status=${status}` : ''}`),
  get: (id: number) => http.get<Room>(`/rooms/${id}`),
  create: (title: string) => http.post<Room>('/rooms', { title }),
  end: (id: number) => http.post<Room>(`/rooms/${id}/end`),
  remove: (id: number) => http.del<void>(`/rooms/${id}`),
  playUrls: (id: number) => http.get<PlayUrls>(`/rooms/${id}/play-urls`)
};

export const productsApi = {
  mine: () => http.get<Product[]>('/products'),
  create: (p: { title: string; price: number; imageUrl?: string; detailUrl?: string; stock?: number }) =>
    http.post<Product>('/products', p)
};

export const shelfApi = {
  list: (roomId: number) => http.get<Product[]>(`/rooms/${roomId}/products`),
  mount: (roomId: number, productId: number, sort = 0) =>
    http.post<void>(`/rooms/${roomId}/products`, { productId, sort }),
  unmount: (roomId: number, productId: number) =>
    http.del<void>(`/rooms/${roomId}/products/${productId}`)
};

export const cartApi = {
  list: () => http.get<CartEntry[]>('/cart'),
  add: (productId: number, qty = 1, roomId?: number) =>
    http.post<CartEntry>('/cart/items', { productId, qty, roomId }),
  updateQty: (itemId: number, qty: number) => http.patch<CartEntry>(`/cart/items/${itemId}`, { qty }),
  remove: (itemId: number) => http.del<void>(`/cart/items/${itemId}`)
};

export const moderationApi = {
  mute: (roomId: number, userId: string, durationSec: number) =>
    http.post<void>(`/rooms/${roomId}/mutes`, { userId, durationSec }),
  unmute: (roomId: number, userId: string) => http.del<void>(`/rooms/${roomId}/mutes/${userId}`),
  deleteMessage: (roomId: number, messageId: string) =>
    http.del<void>(`/rooms/${roomId}/messages/${messageId}`)
};

export const adminApi = {
  rooms: () => http.get<Room[]>('/admin/rooms'),
  forceClose: (id: number) => http.post<Room>(`/admin/rooms/${id}/force-close`),
  ban: (userId: string, reason: string) => http.post<void>(`/admin/users/${userId}/ban`, { reason }),
  unban: (userId: string) => http.del<void>(`/admin/users/${userId}/ban`)
};
