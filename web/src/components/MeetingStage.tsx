import { useEffect, useRef, useState } from 'react';
import { roomsApi } from '../api/endpoints';
import { whipPublish, whipStop, WhipSession } from '../realtime/whip';

/**
 * 腾讯会议式开播：悬浮工具条独立控制 麦克风/摄像头/共享屏幕。
 * - 视频经画布合成后推单轨：摄像头与屏幕共享可同屏（屏幕全屏 + 摄像头画中画），
 *   开关任一画面源都只改画布内容，推流会话零闪断
 * - 音频按当前源组合重算应发轨道并 replaceTrack（参考成熟实践）：
 *   屏幕声+麦克风=WebAudio 混音单轨；仅屏幕声=屏幕音轨直发；仅麦克风=麦克风轨直发；
 *   无声=静音占位轨（保住音频 m-line，切换模式免重新协商）
 * - 麦克风约束显式开回声抑制/降噪/自动增益；屏幕系统声约束关闭这三项（避免处理失真）
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
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const silentTrackRef = useRef<MediaStreamTrack | null>(null);
  const silentCtxRef = useRef<AudioContext | null>(null);

  // 混音（仅"屏幕声+麦克风"同开时使用）
  const mixCtxRef = useRef<AudioContext | null>(null);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixSourcesRef = useRef<MediaStreamAudioSourceNode[]>([]);

  // 原始媒体
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const canvasTrackRef = useRef<MediaStreamTrack | null>(null);
  const rafRef = useRef(0);
  const prevStatusRef = useRef<'IDLE' | 'LIVING' | null>(null);

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
    micTrackRef.current?.stop();
    micTrackRef.current = null;
    micStreamRef.current = null;
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    mixSourcesRef.current = [];
    mixDestRef.current = null;
    mixCtxRef.current?.close().catch(() => {});
    mixCtxRef.current = null;
    silentTrackRef.current?.stop();
    silentTrackRef.current = null;
    silentCtxRef.current?.close().catch(() => {});
    silentCtxRef.current = null;
    canvasTrackRef.current = null;
    audioSenderRef.current = null;
    flags.current = { micOn: false, camOn: false, screenOn: false, publishing: false };
    setPublishing(false); setMicOn(false); setCamOn(false); setScreenOn(false);
    if (mainVideoRef.current) mainVideoRef.current.srcObject = null;
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

  /** 静音占位轨：无声模式也保留音频 m-line（ConstantSource 过 0 增益，参考成熟做法） */
  function ensureSilentTrack(): MediaStreamTrack {
    if (silentTrackRef.current) return silentTrackRef.current;
    const ctx = new AudioContext();
    silentCtxRef.current = ctx;
    const src = ctx.createConstantSource();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const dst = ctx.createMediaStreamDestination();
    src.connect(gain); gain.connect(dst);
    src.start();
    silentTrackRef.current = dst.stream.getAudioTracks()[0];
    return silentTrackRef.current;
  }

  /** 按当前源组合重算混音器（仅"屏幕声+麦克风"同开时走混音） */
  function rebuildMixer(screenAudio: MediaStreamTrack | null, mic: MediaStreamTrack | null) {
    mixSourcesRef.current.forEach(node => { try { node.disconnect(); } catch (_) {} });
    mixSourcesRef.current = [];
    if (!screenAudio && !mic) return;
    if (!mixCtxRef.current) mixCtxRef.current = new AudioContext();
    if (!mixDestRef.current) mixDestRef.current = mixCtxRef.current.createMediaStreamDestination();
    const ctx = mixCtxRef.current;
    for (const t of [screenAudio, mic].filter(Boolean) as MediaStreamTrack[]) {
      const node = ctx.createMediaStreamSource(new MediaStream([t]));
      node.connect(mixDestRef.current);
      mixSourcesRef.current.push(node);
    }
  }

  /** 按源组合计算当前应发布的音频轨：双源=混音单轨，单源=直发，无源=静音占位 */
  function currentAudioTrack(): MediaStreamTrack {
    const screenAudio = flags.current.screenOn
      ? screenStreamRef.current?.getAudioTracks()[0] ?? null : null;
    const mic = flags.current.micOn ? micTrackRef.current : null;
    if (screenAudio && mic) {
      rebuildMixer(screenAudio, mic);
      return mixDestRef.current!.stream.getAudioTracks()[0];
    }
    rebuildMixer(null, null);
    if (screenAudio) return screenAudio;
    if (mic) return mic;
    return ensureSilentTrack();
  }

  /** 组装/更新发布轨：音频按源组合 replaceTrack（免重新协商），视频为合成画布 */
  async function ensurePublish() {
    startCompositor();
    const audio = currentAudioTrack();
    if (!sessionRef.current) {
      const url = await whipUrl();
      sessionRef.current = await whipPublish(url, new MediaStream([canvasTrackRef.current!, audio]));
      const senders = sessionRef.current.pc.getSenders();
      audioSenderRef.current = senders.find(s => s.track?.kind === 'audio') ?? null;
      // 屏幕内容对分辨率敏感：固定分辨率优先、只降帧不降清晰度（参考成熟实践）
      const vSender = senders.find(s => s.track?.kind === 'video');
      if (vSender) {
        try {
          const params = vSender.getParameters();
          params.degradationPreference = 'maintain-resolution';
          if (params.encodings?.length) {
            params.encodings[0].maxBitrate = 2_500_000;
            params.encodings[0].maxFramerate = 30;
          }
          await vSender.setParameters(params);
        } catch (_) { /* SRS 不接受时忽略 */ }
      }
      setFlag('publishing', true);
    } else {
      await audioSenderRef.current?.replaceTrack(audio).catch(() => {});
    }
    attachPreview(audio);
  }

  function attachPreview(audio: MediaStreamTrack) {
    if (!mainVideoRef.current || !canvasTrackRef.current) return;
    mainVideoRef.current.srcObject = new MediaStream([canvasTrackRef.current, audio]);
  }

  /** 麦克风约束：回声抑制/降噪/自动增益，避免屏幕声被麦克风二次采集造成回音 */
  const MIC_CONSTRAINTS: MediaTrackConstraints = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1
  };

/** 媒体设备错误 → 用户能看懂并知道怎么处理的提示（真实环境最常见故障源） */
function mediaErrorHint(e: unknown, what: string): string {
  const name = e instanceof DOMException ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
      return `${what}权限被拒绝：点击地址栏左侧的锁/调音器图标，将${what}设为「允许」后重试`;
    case 'NotFoundError':
      return `未检测到可用的${what}设备（可先用「共享屏幕」开播，系统声音不依赖麦克风）`;
    case 'NotReadableError':
      return `${what}无响应或被其他应用占用，请重试或关闭占用它的程序`;
    default:
      return e instanceof Error ? `${what}打开失败：${e.message}` : `${what}打开失败`;
  }
}

/**
 * 带设备预检与超时的 getUserMedia：
 * 真实环境无输入设备时 Chrome 的请求可能既不成功也不失败（挂死），
 * 必须预检设备列表 + 限时兜底，保证用户点了必出结果（开播或明确报错）
 */
async function safeGetUserMedia(constraints: MediaStreamConstraints, kind: 'audioinput' | 'videoinput'): Promise<MediaStream> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (!devices.some(d => d.kind === kind)) {
    throw new DOMException(kind === 'audioinput' ? 'no audio input device' : 'no camera device', 'NotFoundError');
  }
  return Promise.race([
    navigator.mediaDevices.getUserMedia(constraints),
    new Promise<MediaStream>((_, reject) =>
      setTimeout(() => reject(new DOMException('device not responding', 'NotReadableError')), 6000)),
  ]);
}

  async function toggleMic() {
    setError('');
    if (!mediaOk) { setError(SECURE_HINT); return; }
    try {
      if (micOn) {
        setFlag('micOn', false);
        if (micTrackRef.current) micTrackRef.current.enabled = false;
      } else {
        if (!micTrackRef.current) {
          const stream = await safeGetUserMedia({ audio: MIC_CONSTRAINTS }, 'audioinput');
          micStreamRef.current = stream;
          micTrackRef.current = stream.getAudioTracks()[0];
        }
        micTrackRef.current.enabled = true;
        setFlag('micOn', true);
      }
      await ensurePublish();
      maybeAutoStop();
    } catch (e) { setError(mediaErrorHint(e, '麦克风')); }
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
        const stream = await safeGetUserMedia({ video: true }, 'videoinput');
        camStreamRef.current = stream;
        if (camVideoRef.current) {
          camVideoRef.current.srcObject = stream;
          await camVideoRef.current.play().catch(() => {});
        }
        setFlag('camOn', true);
      }
      await ensurePublish();
      maybeAutoStop();
    } catch (e) { setError(mediaErrorHint(e, '摄像头')); }
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
        screenTrackEnded(display.getVideoTracks()[0]);
        setFlag('screenOn', true);
        // 系统声音只在共享「整个屏幕」且勾选复选框时才有（共享窗口/标签页无此选项）
        if (display.getAudioTracks().length === 0) {
          setError('本次共享未包含系统声音：如需系统声音，请共享「整个屏幕」并勾选「同时分享系统声音」；麦克风声音不受影响');
        }
      }
      await ensurePublish();
      maybeAutoStop();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        setError('屏幕共享被取消或权限被拒绝；如需系统声音，请共享「整个屏幕」并勾选「同时分享系统声音」');
      } else {
        setError(mediaErrorHint(e, '屏幕共享'));
      }
    }
  }

  /** 浏览器"停止共享"按钮与页面按钮等价 */
  function screenTrackEnded(track: MediaStreamTrack) {
    track.addEventListener('ended', () => {
      stopScreen();
      ensurePublish().then(() => maybeAutoStop()).catch(() => {});
    });
  }

  async function stopScreen() {
    setFlag('screenOn', false);
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
    micTrackRef.current?.stop();
    micTrackRef.current = null;
    micStreamRef.current = null;
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    mixSourcesRef.current = [];
    mixDestRef.current = null;
    mixCtxRef.current?.close().catch(() => {});
    mixCtxRef.current = null;
    silentTrackRef.current?.stop();
    silentTrackRef.current = null;
    silentCtxRef.current?.close().catch(() => {});
    silentCtxRef.current = null;
    canvasTrackRef.current = null;
    audioSenderRef.current = null;
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
          <span className="muted" style={{ fontSize: 12 }}>摄像头与屏幕可同屏（画中画）· 屏幕共享可带系统声音 · 麦克风可单独开播</span>
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
