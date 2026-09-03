import { describe, expect, it } from 'vitest';
import { applyEvent, emptySocketState, SocketState } from './socket-events';

const base: SocketState = emptySocketState();

describe('applyEvent', () => {
  it('chat appends message', () => {
    const s = applyEvent(base, { type: 'chat', messageId: 'm1', userId: 'u1', nickname: 'n', content: 'hi', ts: 1 });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].content).toBe('hi');
  });

  it('message_deleted removes by id', () => {
    let s = applyEvent(base, { type: 'chat', messageId: 'm1', userId: 'u1', nickname: 'n', content: 'hi', ts: 1 });
    s = applyEvent(s, { type: 'message_deleted', messageId: 'm1' });
    expect(s.messages).toHaveLength(0);
  });

  it('presence updates viewers', () => {
    const s = applyEvent(base, { type: 'presence', viewers: 3, users: ['a', 'b', 'c'] });
    expect(s.viewers).toBe(3);
    expect(s.users).toEqual(['a', 'b', 'c']);
  });

  it('room_status updates status', () => {
    const s = applyEvent(base, { type: 'room_status', status: 'LIVING' });
    expect(s.status).toBe('LIVING');
  });

  it('product_update add then remove keeps shelf consistent', () => {
    let s = applyEvent(base, { type: 'product_update', action: 'add', product: { id: 1, title: '卫衣', price: 99, imageUrl: null, detailUrl: null } });
    expect(s.products).toHaveLength(1);
    s = applyEvent(s, { type: 'product_update', action: 'add', product: { id: 2, title: '袜子', price: 9, imageUrl: null, detailUrl: null } });
    s = applyEvent(s, { type: 'product_update', action: 'remove', product: { id: 1, title: '卫衣', price: 99, imageUrl: null, detailUrl: null } });
    expect(s.products.map(p => p.id)).toEqual([2]);
  });

  it('history replaces messages', () => {
    const s = applyEvent(base, { type: 'history', messages: [{ messageId: 'm0', userId: 'u0', nickname: 'n0', content: 'old', ts: 0 }] });
    expect(s.messages).toHaveLength(1);
  });
});
