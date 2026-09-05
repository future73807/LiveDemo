import { useEffect, useRef, useState } from 'react';
import { roomsApi } from '../api/endpoints';
import { whipPublish, whipStop, WhipSession } from '../realtime/whip';

type VideoMode = 'off' | 'camera' | 'screen';

/**
 * 腾讯会议式开播：主播进入房间即是"会场"，悬浮工具条一键开关
 * 麦克风/摄像头/共享屏幕，网页直接开播（WHIP），无推流码概念。
 * 切换画面源用 replaceTrack，推流会话不断，观众端不闪断。
 */
export default function MeetingStage({ roomId, roomStatus, onEnded }: {
  roomId: number;
  roomStatus: 'IDLE' | 'LIVING' | null;
  onEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<WhipSession | null>(null);
  const whipRef = useRef('');
  const audioRef = useRef<MediaStreamTrack | null>(null);   // 当前推流的音轨（麦克风或静音轨）
  const camStreamRef = useRef<MediaStream | null>(null);    // 摄像头流（共享屏幕期间保持活跃，便于切回）
  const camVideoRef = useRef<MediaStreamTrack | null>(null);
  const prevModeRef = useRef<VideoMode>('off');             // 共享屏幕前的画面模式
  const modeRef = useRef<VideoMode>('off');

  const [publishing, setPublishing] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { roomsApi.publishUrls(roomId).then(u => { whipRef.current = u.whip; }).catch(() => {}); }, [roomId]);
  useEffect(() => () => { cleanup(); }, []);   // 卸载清理

  // 被管理员强制关播（LIVING→IDLE 翻转）时停掉本端推流：房间已 IDLE，继续推流只会白白占用
  // prevStatus 守卫：刚开播瞬间 status 仍是初始 IDLE，不能误停
  const prevStatusRef = useRef<'IDLE' | 'LIVING' | null>(null);
  useEffect(() => {
    if (prevStatusRef.current === 'LIVING' && roomStatus === 'IDLE' && sessionRef.current) {
      stopPublishing();
      setError('直播已被管理员结束，可重新开启摄像头开播');
    }
    prevStatusRef.current = roomStatus;
  }, [roomStatus]);

  function cleanup() {
    if (sessionRef.current) { whipStop(sessionRef.current).catch(() => {}); sessionRef.current = null; }
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    audioRef.current = null;
    camVideoRef.current = null;
    modeRef.current = 'off';
    attachPreview(null);
  }

  function attachPreview(video: MediaStreamTrack | null) {
    if (!videoRef.current) return;
    if (!video && !audioRef.current) { videoRef.current.srcObject = null; return; }
    const tracks = [video, audioRef.current].filter(Boolean) as MediaStreamTrack[];
    videoRef.current.srcObject = new MediaStream(tracks);
  }

  /** WHIP 地址懒加载：首屏加载后立刻点开播时，预取可能尚未返回（否则 fetch('') 会打出 404） */
  async function whipUrl(): Promise<string> {
    if (!whipRef.current) {
      const u = await roomsApi.publishUrls(roomId);
      whipRef.current = u.whip;
    }
    return whipRef.current;
  }

  /** 已建立会话时仅替换画面轨；未建立则带初始画面建立会话 */
  async function ensurePublish(video: MediaStreamTrack | null) {
    const session = sessionRef.current;
    if (!session) {
      const url = await whipUrl();
      const tracks = [video, audioRef.current].filter(Boolean) as MediaStreamTrack[];
      sessionRef.current = await whipPublish(url, new MediaStream(tracks));
      setPublishing(true);
      attachPreview(video);
      return;
    }
    const sender = session.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender && video) await sender.replaceTrack(video);
    else if (sender && !video) await sender.replaceTrack(null);
    attachPreview(video);
  }

  async function toggleCamera() {
    setError('');
    if (!mediaOk) { setError(SECURE_HINT); return; }
    try {
      if (modeRef.current === 'screen') { await stopShare(); return; }
      if (camOn) {   // 关摄像头：停发画面但不中断会话（占位黑屏保持音轨）
        if (camVideoRef.current) camVideoRef.current.enabled = false;
        setCamOn(false);
        attachPreview(null);
        return;
      }
      if (!camStreamRef.current) {
        camStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        camVideoRef.current = camStreamRef.current.getVideoTracks()[0];
        audioRef.current = camStreamRef.current.getAudioTracks()[0] ?? null;
        setMicOn(true);
      } else {
        camVideoRef.current = camStreamRef.current.getVideoTracks()[0];
        camVideoRef.current.enabled = true;
      }
      await ensurePublish(camVideoRef.current);
      modeRef.current = 'camera';
      setCamOn(true);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '打开摄像头失败（需 HTTPS 环境并授权）'); }
  }

  async function toggleScreen() {
    setError('');
    if (!mediaOk) { setError(SECURE_HINT); return; }
    try {
      if (sharing) { await stopShare(); return; }
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      prevModeRef.current = modeRef.current === 'camera' && camOn ? 'camera' : 'off';
      // 浏览器"停止共享"按钮与页面按钮等价
      screenTrack.addEventListener('ended', () => { stopShare().catch(() => {}); });
      await ensurePublish(screenTrack);
      modeRef.current = 'screen';
      setSharing(true);
    } catch (e) { setError(e instanceof Error ? e.message : '打开屏幕共享失败（需 HTTPS 环境并授权）'); }
  }

  async function stopShare() {
    setSharing(false);
    if (prevModeRef.current === 'camera' && camVideoRef.current) {
      camVideoRef.current.enabled = true;
      await ensurePublish(camVideoRef.current);
      modeRef.current = 'camera';
      setCamOn(true);
    } else {
      await stopPublishing();
    }
  }

  async function stopPublishing() {
    if (sessionRef.current) {
      whipStop(sessionRef.current).catch(() => {});
      sessionRef.current = null;
    }
    modeRef.current = 'off';
    setPublishing(false);
    setSharing(false);
    setCamOn(false);
    attachPreview(null);
  }

  function toggleMic() {
    if (!audioRef.current) return;
    audioRef.current.enabled = !micOn;
    setMicOn(!micOn);
  }

  const hasMic = !!audioRef.current;
  // 非安全上下文（非 localhost/127.0.0.1 且非 HTTPS）：浏览器整体禁用媒体 API，
  // navigator.mediaDevices 为 undefined——必须提前拦截并给出人话，而不是抛 TypeError
  const mediaOk = !!navigator.mediaDevices && window.isSecureContext;
  const SECURE_HINT = `当前通过 http://${location.host} 访问，浏览器已禁用摄像头/麦克风/屏幕共享。请改用 http://localhost:${location.port || '80'} 访问，或为站点部署 HTTPS（README「网页开播要求与排错」）`;

  return (
    <div className="player-box meeting">
      <video ref={videoRef} autoPlay muted playsInline />
      {!publishing && (
        <div className="player-placeholder">
          <span className="ph-icon">LIVE</span>
          开启摄像头或共享屏幕，直接开播
          <span className="muted" style={{ fontSize: 12 }}>网页开播，观众进房即看</span>
          {!mediaOk && (
            <span className="meeting-secure-warn">
              当前地址（http://{location.host}）不是安全上下文，浏览器已禁用摄像头/麦克风/屏幕共享。
              请改用 http://localhost:{location.port || '80'} 访问，或部署 HTTPS。
            </span>
          )}
        </div>
      )}
      {error && <div className="meeting-error">{error}</div>}
      <div className="meeting-toolbar">
        <button
          className={!publishing || !hasMic ? 'off' : micOn ? 'on' : 'warn'}
          disabled={!publishing || !hasMic}
          title={micOn ? '关闭麦克风' : '打开麦克风'}
          onClick={toggleMic}>
          {micOn ? '麦克风' : '已静音'}
        </button>
        <button
          className={modeRef.current === 'camera' && camOn ? 'on' : ''}
          title={sharing ? '切回摄像头画面' : camOn ? '关闭摄像头' : '开启摄像头'}
          onClick={toggleCamera}>
          {modeRef.current === 'camera' && !camOn ? '摄像头已关' : sharing ? '切回摄像头' : '摄像头'}
        </button>
        <button
          className={sharing ? 'on' : ''}
          title={sharing ? '停止屏幕共享' : '共享屏幕'}
          onClick={toggleScreen}>
          {sharing ? '停止共享' : '共享屏幕'}
        </button>
        <button className="danger" onClick={async () => { cleanup(); onEnded(); }}>结束直播</button>
      </div>
    </div>
  );
}
