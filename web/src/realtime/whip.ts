export interface WhipSession { pc: RTCPeerConnection; location: string | null; }

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => resolve();
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') done();
    });
    setTimeout(done, 1500);   // 兜底：收集慢时也继续（WHIP 非 trickle，SRS 可靠回包）
  });
}

/** SRS WHIP 要求音视频齐备：无麦克风时补静音轨 */
export function silentAudioTrack(): MediaStreamTrack {
  const ctx = new AudioContext();
  const dst = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(dst);
  osc.start();
  return dst.stream.getAudioTracks()[0];
}

export async function whipPublish(url: string, stream: MediaStream): Promise<WhipSession> {
  if (stream.getAudioTracks().length === 0) stream.addTrack(silentAudioTrack());
  const pc = new RTCPeerConnection();
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc);
  const resp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp
  });
  if (!resp.ok) { pc.close(); throw new Error(`WHIP 推流失败: ${resp.status}`); }
  const answer = await resp.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  const loc = resp.headers.get('Location');
  // 推流地址可能是同源相对路径（base 模式），Location 解析时补全 origin
  const baseUrl = /^https?:\/\//i.test(url) ? url : window.location.origin + url;
  return { pc, location: loc ? new URL(loc, baseUrl).toString() : null };
}

export async function whipStop(session: WhipSession): Promise<void> {
  try { if (session.location) await fetch(session.location, { method: 'DELETE' }); } catch { /* 尽力而为 */ }
  session.pc.close();
}
