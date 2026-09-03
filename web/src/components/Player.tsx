import { useEffect, useRef, useState } from 'react';
import mpegts from 'mpegts.js';
import type { PlayUrls } from '../api/types';

const WHEP_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('WHEP 超时')), ms))]);
}

async function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>(resolve => {
    const done = () => resolve();
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') done();
    });
    setTimeout(done, 1500);   // 兜底：STUN 不可达时也继续
  });
}

/** SRS 标准 WHEP 拉流（设计 §6.2），返回清理函数 */
async function whepPlay(video: HTMLVideoElement, url: string): Promise<() => void> {
  const pc = new RTCPeerConnection();
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = event => { video.srcObject = event.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGathering(pc);

  const resp = await withTimeout(fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription?.sdp
  }), WHEP_TIMEOUT_MS);
  if (!resp.ok) throw new Error(`WHEP 失败: ${resp.status}`);
  const answerSdp = await resp.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  return () => pc.close();
}

export default function Player({ playUrls, status }: { playUrls: PlayUrls | null; status: 'IDLE' | 'LIVING' | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'idle' | 'webrtc' | 'flv' | 'failed'>('idle');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playUrls || status !== 'LIVING') { setMode('idle'); return; }
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      // 1. 优先 WebRTC
      try {
        cleanup = await whepPlay(video, playUrls.webrtc);
        if (cancelled) { cleanup(); return; }
        setMode('webrtc');
        await video.play().catch(() => {});
        return;
      } catch { /* 落入 FLV 降级 */ }
      // 2. 降级 HTTP-FLV
      if (cancelled || !mpegts.isSupported()) { if (!cancelled) setMode('failed'); return; }
      const player = mpegts.createPlayer({
        type: 'flv', isLive: true, url: playUrls.flv
      }, { enableStashBuffer: false, liveBufferLatencyChasing: true });
      player.attachMediaElement(video);
      player.load();
      setMode('flv');
      video.play().catch(() => {});
      cleanup = () => player.destroy();
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      video.srcObject = null;
    };
  }, [playUrls, status]);

  return (
    <div className="player-box">
      <video ref={videoRef} autoPlay muted playsInline />
      {status !== 'LIVING' && <div className="player-placeholder">主播还未开播</div>}
      {status === 'LIVING' && mode === 'failed' && (
        <div className="player-placeholder">播放失败 <button onClick={() => setMode('idle')}>重试</button></div>
      )}
      {mode === 'flv' && (
        <span className="badge" style={{ position: 'absolute', left: 8, top: 8 }}>FLV 模式</span>
      )}
    </div>
  );
}
