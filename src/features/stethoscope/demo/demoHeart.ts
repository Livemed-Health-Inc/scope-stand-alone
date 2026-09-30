/**
 * PREVIEW-ONLY synthetic heart sounds for recording demo videos.
 *
 * - Never available on published/production hosts (see isDemoAudioHost).
 * - Generated locally with Web Audio on an explicit user click — no network,
 *   microphone, Bluetooth or MediaStream is involved.
 * - The same AudioBufferSourceNode feeds both the speakers and the analyser,
 *   so what you hear is exactly what the waveform draws.
 * - It is never turned into a MediaStream, so it cannot reach the WebRTC link
 *   or the real stethoscope pipeline.
 */

export const DEMO_BPM = 72;

/** True only on Lovable preview hosts and local development. */
export function isDemoAudioHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h.endsWith(".lovableproject.com")) return true;
  if (h.endsWith(".lovable.app")) {
    const sub = h.slice(0, -".lovable.app".length);
    // id-preview--<id>, preview--<name>, project--<id>-dev are previews.
    return sub.startsWith("id-preview--") || sub.startsWith("preview--") || sub.endsWith("-dev");
  }
  return false;
}

/** One cardiac cycle of a synthetic lub-dub (S1 + S2), mono PCM in [-1, 1]. */
export function renderHeartCycle(sampleRate: number, bpm = DEMO_BPM): Float32Array<ArrayBuffer> {
  const length = Math.round((60 / bpm) * sampleRate);
  const out = new Float32Array(new ArrayBuffer(length * 4));
  const thump = (startSec: number, durSec: number, freq: number, amp: number) => {
    const start = Math.round(startSec * sampleRate);
    const n = Math.round(durSec * sampleRate);
    for (let i = 0; i < n && start + i < length; i++) {
      const t = i / sampleRate;
      const env = Math.sin((Math.PI * i) / n) ** 2;
      const f = freq * (1 - 0.35 * (i / n)); // slight downward glide
      out[start + i] += amp * env * Math.sin(2 * Math.PI * f * t);
    }
  };
  thump(0.0, 0.11, 55, 0.9); // S1 "lub"
  thump(0.33, 0.08, 75, 0.6); // S2 "dub"
  return out;
}

export interface DemoHeartHandle {
  analyser: AnalyserNode;
  stop: () => void;
}

type CtxCtor = new () => AudioContext;

/** Starts looping playback. Call only from a user gesture. */
export function startDemoHeart(Ctor?: CtxCtor, bpm = DEMO_BPM): DemoHeartHandle {
  const C =
    Ctor ??
    (window.AudioContext ??
      (window as unknown as { webkitAudioContext: CtxCtor }).webkitAudioContext);
  const ctx = new C();
  const pcm = renderHeartCycle(ctx.sampleRate, bpm);
  const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
  buffer.getChannelData(0).set(pcm);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.7;
  const out = ctx.createGain();
  out.gain.value = 0.8;
  src.connect(analyser); // same signal → waveform
  src.connect(out); // same signal → speakers
  out.connect(ctx.destination);
  void ctx.resume().catch(() => {});
  src.start();
  let stopped = false;
  return {
    analyser,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
      analyser.disconnect();
      out.disconnect();
      void ctx.close().catch(() => {});
    },
  };
}
