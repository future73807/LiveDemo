import { useEffect, useRef, useState } from 'react';
import { roomsApi } from '../api/endpoints';
import { whipPublish, whipStop, WhipSession } from '../realtime/whip';

type Source = 'camera' | 'screen';

export default function StudioPanel({ roomId, onEnded }: { roomId: number; onEnded: () => void }) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState('');
  const [micId, setMicId] = useState('');
  const [source, setSource] = useState<Source>('camera');
  const [publishing, setPublishing] = useState(false);
  const [hasPreview, setHasPreview] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState('');
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<WhipSession | null>(null);
  const whipRef = useRef('');

  useEffect(() => { roomsApi.publishUrls(roomId).then(u => { whipRef.current = u.whip; }).catch(() => {}); }, [roomId]);
  useEffect(() => {
    if (!publishing) return;
    const timer = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [publishing]);

  async function openStream(): Promise<MediaStream> {
    if (source === 'screen') return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    return navigator.mediaDevices.getUserMedia({
      video: camId ? { deviceId: { exact: camId } } : true,
      audio: micId ? { deviceId: { exact: micId } } : true
    });
  }

  async function preview() {
    stopPreview();
    try {
      const s = await openStream();
      streamRef.current = s;
      if (previewRef.current) previewRef.current.srcObject = s;
      setHasPreview(true);
      const all = await navigator.mediaDevices.enumerateDevices();
      setCams(all.filter(d => d.kind === 'videoinput'));
      setMics(all.filter(d => d.kind === 'audioinput'));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '打开设备失败（需 HTTPS 环境并授权）'); }
  }
  function stopPreview() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setHasPreview(false);
  }

  async function start() {
    setError('');
    try {
      if (!streamRef.current) await preview();
      sessionRef.current = await whipPublish(whipRef.current, streamRef.current!);
      setPublishing(true);
      setSecs(0);
    } catch (e) { setError(e instanceof Error ? e.message : '推流失败'); }
  }

  async function stop() {
    if (sessionRef.current) await whipStop(sessionRef.current);
    sessionRef.current = null;
    setPublishing(false);
  }

  useEffect(() => () => { // 卸载清理
    if (sessionRef.current) whipStop(sessionRef.current);
    stopPreview();
  }, []);

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <div className="card studio" style={{ marginTop: 12 }}>
      <h3 style={{ marginBottom: 8 }}>开播台</h3>
      {error && <div className="error-text" style={{ marginBottom: 6 }}>{error}</div>}
      <div className="studio-preview" style={{ position: 'relative', aspectRatio: '16/9' }}>
        <video ref={previewRef} autoPlay muted playsInline />
        {!publishing && !hasPreview && <div className="player-placeholder">选择设备后点击「预览」</div>}
        {publishing && <span className="live-timer"><span className="dot" />直播中 {mmss}</span>}
      </div>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <span className="seg-group">
          <button className={source === 'camera' ? 'on' : ''} onClick={() => setSource('camera')}>摄像头</button>
          <button className={source === 'screen' ? 'on' : ''} onClick={() => setSource('screen')}>共享屏幕</button>
        </span>
        <button className="primary" onClick={preview}>预览</button>
      </div>
      {source === 'camera' && (
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <select value={camId} onChange={e => setCamId(e.target.value)}>
            <option value="">默认摄像头</option>
            {cams.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || '摄像头'}</option>)}
          </select>
          <select value={micId} onChange={e => setMicId(e.target.value)}>
            <option value="">默认麦克风</option>
            {mics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || '麦克风'}</option>)}
          </select>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        {!publishing
          ? <button className="primary" onClick={start}>开始直播</button>
          : <button className="danger" onClick={stop}>停止推流</button>}
        <button className="danger" onClick={onEnded}>结束直播</button>
      </div>
    </div>
  );
}
