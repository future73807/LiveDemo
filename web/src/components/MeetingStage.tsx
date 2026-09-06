import { useEffect, useRef, useState } from 'react';
import { roomsApi } from '../api/endpoints';
import { whipPublish, whipStop, WhipSession } from '../realtime/whip';

/**
 * 腾讯会议式开播：悬浮工具条独立控制 麦克风/摄像头/共享屏幕。
 * - 视频经画布合成后推单轨：摄像头与屏幕共享可同屏（屏幕全屏 + 摄像头画中画），
 *   开关任一画面源都只改画布内容，推流会话零闪断
 * - 音频经 WebAudio 混音成单轨：麦克风独立开关（可纯麦克风开播），屏幕共享可带系统声音
 */

const CANVAS_W = 1280;
const CANVAS_H = 720;

export default function MeetingStage({ roomId, roomStatus, onEnded }: {
  roomId: number;
  roomStatus: 'IDLE' | 'LIVING' | null;
  onEnded: () => void;
}) {
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const camVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sessionRef = useRef<WhipSession | null>(null);
  const whipRef = useRef('');

  // 音频图：麦克风 / 屏幕声 各自增益后混入同一目的地
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const screenGainRef = useRef<GainNode | null>(null);

  // 原始媒体流
  const micStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const canvasTrackRef = useRef<MediaStreamTrack | null>(null);
  const rafRef = useRef(0);
  const prevStatusRef = useRef<'IDLE' | 'LIVING' | null>(null);

  // 状态镜像（同步读写，供合成循环与自动停播判断）
  const flags = useRef({ micOn: false, camOn: false, screenOn: false, publishing: false });

  const [publishing, setPublishing] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [error, setError] = useState('');

  const SECURE_HINT = `当前通过 http://${location.host} 访问，浏览器已禁用摄像头/麦克风/屏幕共享。请改用 http://localhost:${location.port || '80'} 访问，或为站点部署 HTTPS（README「网页开播要求与排错」）`;
  const mediaOk = !!navigator.mediaDevices && window.isSecureContext;

  function setFlag<K extends keyof typeof flags.current>(key: K, value: (typeof flags.current)[K]) {
    flags.current[key] = value;
    if (key === 'publishing') setPublishing(value);
    if (key === 'micOn') setMicOn(value);
    if (key === 'camOn') setCamOn(value);
    if (key === 'screenOn') setScreenOn(value);
  }

  useEffect(() => { roomsApi.publishUrls(roomId).then(u => { whipRef.current = u.whip; }).catch(() => {}); }, [roomId]);
  useEffect(() => () => { cleanup(); }, []);   // 卸载清理

  // 被管理员强制关播（LIVING→IDLE 翻转）时停掉本端推流；prevStatus 守卫不误伤刚开播瞬间
  useEffect(() => {
    if (prevStatusRef.current === 'LIVING' && roomStatus === 'IDLE' && sessionRef.current) {
      stopPublishing();
      setError('直播已被管理员结束，可重新开启摄像头/麦克风开播');
    }
    prevStatusRef.current = roomStatus;
  }, [roomStatus]);

  function cleanup() {
    if (sessionRef.current) { whipStop(sessionRef.current).catch(() => {}); sessionRef.current = null; }
    cancelAnimationFrame(rafRef.current);
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    screenStreamRef.current = null;
    micGainRef.current?.disconnect();
    screenGainRef.current?.disconnect();
    micGainRef.current = null;
    screenGainRef.current = null;
    canvasTrackRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    mixDestRef.current = null;
    flags.current = { micOn: false, camOn: false, screenOn: false, publishing: false };
    setPublishing(false); setMicOn(false); setCamOn(false); setScreenOn(false);
    if (mainVideoRef.current) mainVideoRef.current.srcObject = null;
  }

  function ensureAudioGraph() {
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      mixDestRef.current = ctx.createMediaStreamDestination();
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
  }

  /** 画布合成循环：屏幕全屏 / 摄像头全屏 / 双源画中画 / 纯黑（纯麦克风直播） */
  function startCompositor() {
    if (canvasTrackRef.current) return;
    const canvas = canvasRef.current!;
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    const g = canvas.getContext('2d')!;
    const draw = () => {
      const cam = camVideoRef.current, scr = screenVideoRef.current;
      const camReady = flags.current.camOn && cam && cam.readyState >= 2;
      const scrReady = flags.current.screenOn && scr && scr.readyState >= 2;
      g.fillStyle = '#000'; g.fillRect(0, 0, CANVAS_W, CANVAS_H);
      const contain = (vid: HTMLVideoElement) => {
        const vw = vid.videoWidth || CANVAS_W, vh = vid.videoHeight || CANVAS_H;
        const s = Math.min(CANVAS_W / vw, CANVAS_H / vh);
        g.drawImage(vid, (CANVAS_W - vw * s) / 2, (CANVAS_H - vh * s) / 2, vw * s, vh * s);
      };
      if (scrReady) contain(scr);
      if (camReady && !scrReady) contain(cam);
      if (camReady && scrReady) {   // 画中画：摄像头缩略在右下
        const vw = cam.videoWidth || 16, vh = cam.videoHeight || 9;
        const pw = 320, ph = pw * (vh / vw);
        g.drawImage(cam, CANVAS_W - pw - 24, CANVAS_H - ph - 24, pw, ph);
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3;
        g.strokeRect(CANVAS_W - pw - 24, CANVAS_H - ph - 24, pw, ph);
      }
      if (!camReady && !scrReady) {
        g.fillStyle = '#555'; g.font = '600 36px sans-serif'; g.textAlign = 'center';
        g.fillText('麦克风直播中', CANVAS_W / 2, CANVAS_H / 2);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    canvasTrackRef.current = canvas.captureStream(30).getVideoTracks()[0];
  }

  /** WHIP 地址懒加载（预取未返回时兜底） */
  async function whipUrl(): Promise<string> {
    if (!whipRef.current) {
      const u = await roomsApi.publishUrls(roomId);
      whipRef.current = u.whip;
    }
    return whipRef.current;
  }

  /** 建立会话（画布视频轨 + 混音音轨）；已建立则只刷新预览 */
  async function ensurePublish() {
    startCompositor();
    ensureAudioGraph();
    if (!sessionRef.current) {
      const url = await whipUrl();
      const tracks = [canvasTrackRef.current!, mixDestRef.current!.stream.getAudioTracks()[0]];
      sessionRef.current = await whipPublish(url, new MediaStream(tracks));
      setFlag('publishing', true);
    }
    attachPreview();
  }

  function attachPreview() {
    if (!mainVideoRef.current || !canvasTrackRef.current || !mixDestRef.current) return;
    mainVideoRef.current.srcObject = new MediaStream([
      canvasTrackRef.current,
      mixDestRef.current.stream.getAudioTracks()[0]
    ]);
  }

  async function toggleMic() {
    setError('');
    if (!mediaOk) { setError(SECURE_HINT); return; }
    try {
      ensureAudioGraph();
      if (micOn && micGainRef.current) {
        micGainRef.current.gain.value = 0;   // 静音保留链路
        setFlag('micOn', false);
      } else {
        if (!micGainRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = stream;
          const src = audioCtxRef.current!.createMediaStreamSource(stream);
          const gain = audioCtxRef.current!.createGain();
          src.connect(gain).connect(mixDestRef.current!);
          micGainRef.current = gain;
        }
        micGainRef.current.gain.value = 1;
        setFlag('micOn', true);
      }
      await ensurePublish();
      maybeAutoStop();
    } catch (e) { setError(e instanceof Error ? e.message : '打开麦克风失败（需 HTTPS 环境并授权）'); }
  }

  async function toggleCamera() {
    setError('');
    if (!mediaOk) { setError(SECURE_HINT); return; }
    try {
      if (camOn) {
        camStreamRef.current?.getTracks().forEach(t => t.stop());
        camStreamRef.current = null;
        if (camVideoRef.current) camVideoRef.current.srcObject = null;
        setFlag('camOn', false);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        camStreamRef.current = stream;
        if (camVideoRef.current) {
          camVideoRef.current.srcObject = stream;
          await camVideoRef.current.play().catch(() => {});
        }
        setFlag('camOn', true);
      }
      await ensurePublish();
      maybeAutoStop();
    } catch (e) { setError(e instanceof Error ? e.message : '打开摄像头失败（需 HTTPS 环境并授权）'); }
  }

  async function toggleScreen() {
    setError('');
    if (!mediaOk) { setError(SECURE_HINT); return; }
    try {
      if (screenOn) {
        await stopScreen();
      } else {
        // audio:true + systemAudio:include：Chrome 共享弹窗默认勾选"同时分享系统声音"
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        } as DisplayMediaStreamOptions);
        screenStreamRef.current = display;
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = display;
          await screenVideoRef.current.play().catch(() => {});
        }
        ensureAudioGraph();
        connectScreenAudio(display.getAudioTracks()[0]);
        screenTrackEnded(screenStreamRef.current.getVideoTracks()[0]);
        setFlag('screenOn', true);
      }
      await ensurePublish();
      maybeAutoStop();
    } catch (e) { setError(e instanceof Error ? e.message : '打开屏幕共享失败（需 HTTPS 环境并授权）'); }
  }

  /** 浏览器"停止共享"按钮与页面按钮等价 */
  function screenTrackEnded(track: MediaStreamTrack) {
    track.addEventListener('ended', () => {
      stopScreen();
      ensurePublish().then(() => maybeAutoStop()).catch(() => {});
    });
  }

  /** 屏幕声接线：旧节点连的是上一轮已结束的轨道，每次共享必须断开重建，否则二次共享无声 */
  function connectScreenAudio(track: MediaStreamTrack | undefined) {
    screenGainRef.current?.disconnect();
    screenGainRef.current = null;
    if (!track || !audioCtxRef.current || !mixDestRef.current) return;
    const src = audioCtxRef.current.createMediaStreamSource(new MediaStream([track]));
    const gain = audioCtxRef.current.createGain();
    src.connect(gain).connect(mixDestRef.current);
    screenGainRef.current = gain;
  }

  async function stopScreen() {
    setFlag('screenOn', false);
    screenGainRef.current?.disconnect();
    screenGainRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
  }

  /** 画面源与麦克风全关后自动停播，避免黑场空推 */
  function maybeAutoStop() {
    const f = flags.current;
    if (f.publishing && !f.micOn && !f.camOn && !f.screenOn) stopPublishing();
  }

  async function stopPublishing() {
    if (sessionRef.current) {
      whipStop(sessionRef.current).catch(() => {});
      sessionRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    camStreamRef.current?.getVideoTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    micGainRef.current?.disconnect();
    screenGainRef.current?.disconnect();
    micGainRef.current = null;
    screenGainRef.current = null;
    canvasTrackRef.current = null;
    setFlag('publishing', false);
    setFlag('camOn', false);
    setFlag('screenOn', false);
    setFlag('micOn', false);
    if (mainVideoRef.current) mainVideoRef.current.srcObject = null;
  }

  return (
    <div className="player-box meeting">
      <video ref={mainVideoRef} autoPlay muted playsInline />
      <video ref={camVideoRef} autoPlay muted playsInline className="meeting-src-video" />
      <video ref={screenVideoRef} autoPlay muted playsInline className="meeting-src-video" />
      <canvas ref={canvasRef} className="meeting-src-video" />
      {!publishing && (
        <div className="player-placeholder">
          <span className="ph-icon">LIVE</span>
          开启麦克风、摄像头或共享屏幕，直接开播
          <span className="muted" style={{ fontSize: 12 }}>摄像头与屏幕可同屏（画中画）· 屏幕共享可带系统声音</span>
          {!mediaOk && (
            <span className="meeting-secure-warn">
              当前地址（http://{location.host}）不是安全上下文，浏览器已禁用摄像头/麦克风/屏幕共享。
              请改用 http://localhost:{location.port || '80'} 访问，或部署 HTTPS。
            </span>
          )}
        </div>
      )}
      {publishing && !camOn && !screenOn && (
        <div className="meeting-tag">麦克风直播中（无画面）</div>
      )}
      {error && <div className="meeting-error">{error}</div>}
      <div className="meeting-toolbar">
        <button
          className={micOn ? 'on' : ''}
          title={micOn ? '关闭麦克风' : '开启麦克风（可单独开播）'}
          onClick={toggleMic}>
          {micOn ? '麦克风' : '麦克风已关'}
        </button>
        <button
          className={camOn ? 'on' : ''}
          title={camOn ? '关闭摄像头' : '开启摄像头（可与屏幕共享同屏）'}
          onClick={toggleCamera}>
          {camOn ? '摄像头' : '摄像头已关'}
        </button>
        <button
          className={screenOn ? 'on' : ''}
          title={screenOn ? '停止屏幕共享' : '共享屏幕（可同时分享系统声音）'}
          onClick={toggleScreen}>
          {screenOn ? '停止共享' : '共享屏幕'}
        </button>
        <button className="danger" onClick={async () => { cleanup(); onEnded(); }}>结束直播</button>
      </div>
    </div>
  );
}
