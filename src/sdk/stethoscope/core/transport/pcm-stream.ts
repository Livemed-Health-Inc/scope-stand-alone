/**
 * Plays the Smartho's 8 kHz / 16-bit / mono PCM frames through Web Audio.
 * Frames arrive over BLE in bursts, so they are resampled on the main thread and
 * queued in a ring buffer inside an AudioWorklet for glitch-free playback.
 */
import { MINTTI_SAMPLE_RATE } from "./mintti";

const WORKLET = `
class PcmQueueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 48000 * 4;
    this.buf = new Float32Array(this.size);
    this.read = 0;
    this.write = 0;
    this.lastOut = 0;
    this.primed = false;
    this.prime = Math.round(sampleRate * 0.12);
    this.port.onmessage = (e) => {
      if (e.data === 'flush') { this.read = this.write = 0; this.primed = false; this.lastOut = 0; return; }
      const chunk = e.data;
      for (let i = 0; i < chunk.length; i++) {
        this.buf[this.write] = chunk[i];
        this.write = (this.write + 1) % this.size;
      }
    };
  }
  available() {
    return (this.write - this.read + this.size) % this.size;
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.primed) {
      if (this.available() < this.prime) { out.fill(0); return true; }
      this.primed = true;
    }
    for (let i = 0; i < out.length; i++) {
      if (this.read === this.write) {
        // Underrun: decay from the last sample instead of slamming to zero,
        // which is what produced the broadband clicking.
        this.lastOut *= 0.995;
        out[i] = this.lastOut;
        this.primed = false;
        continue;
      }
      this.lastOut = this.buf[this.read];
      out[i] = this.lastOut;
      this.read = (this.read + 1) % this.size;
    }
    return true;
  }
}
registerProcessor('pcm-queue', PcmQueueProcessor);
`;

export interface PcmStreamNode {
  node: AudioNode;
  push(pcm: Int16Array): void;
  flush(): void;
  dispose(): void;
}

export async function createPcmStreamNode(
  ctx: AudioContext,
  sourceRate = MINTTI_SAMPLE_RATE,
): Promise<PcmStreamNode> {
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const node = new AudioWorkletNode(ctx, "pcm-queue", { outputChannelCount: [1] });
  // The firmware's effective frame rate is not exactly the nominal 8 kHz (and
  // varies with BLE connection interval). A fixed ratio slowly drifts, which
  // starves or floods the ring buffer and makes heart sounds click and warble,
  // so the incoming rate is measured continuously and the ratio follows it.
  let measuredRate = sourceRate;
  let ratio = ctx.sampleRate / measuredRate;
  let windowSamples = 0;
  let windowStart = 0;
  let carry = 0; // fractional position carried between frames
  let last = 0;
  // Running amplitude estimate used to spot single-sample decode glitches.
  let rms = 0.01;
  // One-pole DC blocker state (removes per-frame offset steps that click).
  let dcX = 0;
  let dcY = 0;

  /** Replace isolated impulse samples (packet/decode glitches) with their neighbours. */
  const clean = (pcm: Int16Array) => {
    const f = new Float32Array(pcm.length);
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]! / 32768;
      f[i] = v;
      sum += v * v;
    }
    const frameRms = Math.sqrt(sum / Math.max(1, pcm.length));
    rms = rms * 0.9 + frameRms * 0.1;
    const limit = Math.max(rms * 6, 0.02);
    for (let i = 1; i < f.length - 1; i++) {
      const prev = f[i - 1]!;
      const next = f[i + 1]!;
      const mid = (prev + next) / 2;
      if (Math.abs(f[i]! - mid) > limit) f[i] = mid;
    }
    for (let i = 0; i < f.length; i++) {
      const x = f[i]!;
      dcY = x - dcX + 0.995 * dcY;
      dcX = x;
      f[i] = dcY;
    }
    return f;
  };

  const trackRate = (count: number) => {
    const now = ctx.currentTime;
    if (windowStart === 0) {
      windowStart = now;
      return;
    }
    windowSamples += count;
    const elapsed = now - windowStart;
    if (elapsed < 2) return;
    const observed = windowSamples / elapsed;
    windowSamples = 0;
    windowStart = now;
    // Ignore nonsense readings from a stalled link.
    if (observed < sourceRate / 4 || observed > sourceRate * 4) return;
    measuredRate = measuredRate * 0.7 + observed * 0.3;
    ratio = ctx.sampleRate / measuredRate;
  };

  return {
    node,
    push(pcm) {
      trackRate(pcm.length);
      const src = clean(pcm);
      const outLen = Math.floor((pcm.length - carry) * ratio);
      const out = new Float32Array(Math.max(0, outLen));
      for (let i = 0; i < out.length; i++) {
        const pos = carry + i / ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = i0 <= 0 ? last : (src[i0 - 1] ?? 0);
        const b = src[i0] ?? 0;
        out[i] = a + (b - a) * frac;
      }
      carry = carry + out.length / ratio - pcm.length;
      last = src[src.length - 1] ?? 0;
      node.port.postMessage(out);
    },
    flush() {
      node.port.postMessage("flush");
      carry = 0;
      last = 0;
      rms = 0.01;
      dcX = 0;
      dcY = 0;
      windowSamples = 0;
      windowStart = 0;
    },
    dispose() {
      node.port.postMessage("flush");
      node.disconnect();
    },
  };
}
