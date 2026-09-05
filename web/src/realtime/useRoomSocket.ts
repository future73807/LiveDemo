import { useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '../api/client';
import { shelfApi } from '../api/endpoints';
import type { ChatMessage } from '../api/types';
import { applyEvent, emptySocketState, SocketState } from './socket-events';

interface Options {
  onMuted?: (durationSec: number) => void;
  onError?: (code: string, message: string) => void;
}

/** 房间 WS 连接：指数退避重连（1s/2s/4s…上限 30s），重连后重拉房间状态与小黄车（设计 §5.7）
 *  未登录（token 为空）时静默不连接——登录弹窗场景不该对 /ws 发起无凭据的重试风暴 */
export function useRoomSocket(roomId: number | null, options: Options = {}) {
  const [state, setState] = useState<SocketState>(emptySocketState);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(1);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const hasToken = !!getToken();

  useEffect(() => {
    if (roomId === null || !hasToken) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(`/ws?roomId=${roomId}&token=${encodeURIComponent(getToken())}`);
      socketRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 1;
        setConnected(true);
        // 重连后重拉小黄车，消除断线期间的事件缺口
        shelfApi.list(roomId!).then(products =>
          setState(s => ({ ...s, products }))).catch(() => {});
      };
      ws.onmessage = e => {
        const event = JSON.parse(e.data);
        switch (event.type) {
          case 'muted':
            optionsRef.current.onMuted?.(event.durationSec);
            return;
          case 'error':
            optionsRef.current.onError?.(event.code, event.message);
            return;
          default:
            setState(s => applyEvent(s, event));
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        const delay = Math.min(1000 * 2 ** (retryRef.current - 1), 30_000);
        retryRef.current += 1;
        timer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [roomId, hasToken]);   // hasToken 变化（登录/退出）时重建连接：先开房间页后登录也要连上

  const api = useMemo(() => ({
    sendChat(content: string) {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'chat', content }));
      }
    }
  }), []);

  return { state, connected, sendChat: api.sendChat };
}

export type { ChatMessage };
