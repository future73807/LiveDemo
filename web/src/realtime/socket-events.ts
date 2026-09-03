import type { ChatMessage, Product } from '../api/types';

export interface SocketState {
  messages: ChatMessage[];
  viewers: number;
  users: string[];
  status: 'IDLE' | 'LIVING' | null;
  products: Product[];
}

export type SocketEvent =
  | { type: 'history'; messages: ChatMessage[] }
  | { type: 'chat' } & ChatMessage
  | { type: 'presence'; viewers: number; users: string[] }
  | { type: 'room_status'; status: 'IDLE' | 'LIVING' }
  | { type: 'product_update'; action: 'add' | 'remove'; product: Product }
  | { type: 'message_deleted'; messageId: string };

export function emptySocketState(): SocketState {
  return { messages: [], viewers: 0, users: [], status: null, products: [] };
}

/** 纯函数 reducer，服务端 WS 事件 → 状态（便于 vitest 单测） */
export function applyEvent(state: SocketState, event: SocketEvent): SocketState {
  switch (event.type) {
    case 'history':
      return { ...state, messages: event.messages };
    case 'chat':
      return { ...state, messages: [...state.messages, {
        messageId: event.messageId, userId: event.userId, nickname: event.nickname,
        content: event.content, ts: event.ts
      }] };
    case 'presence':
      return { ...state, viewers: event.viewers, users: event.users };
    case 'room_status':
      return { ...state, status: event.status };
    case 'product_update': {
      const others = state.products.filter(p => p.id !== event.product.id);
      return { ...state, products: event.action === 'add' ? [...others, event.product] : others };
    }
    case 'message_deleted':
      return { ...state, messages: state.messages.filter(m => m.messageId !== event.messageId) };
    default:
      return state;
  }
}
