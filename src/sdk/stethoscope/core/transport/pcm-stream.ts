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
    this.fadeSamples = Math.round(sampleRate * 0.012);
    this.fadeLeft = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') { this.read = this.write = 0; this.primed = false; this.lastOut = 0; this.fadeLeft = 0; return; }
      const chunk = e.data;
      for (let i = 0; i < chunk.length; i++) {
        // Never let a producer burst lap the reader. Dropping the oldest audio
        // preserves a continuous live feed instead of turning a full ring into
        // an apparent empty ring (and an audible restart pop).
        const next = (this.write + 1) % this.size;
        if (next === this.read) this.read = (this.read + 1) % this.size;
        this.buf[this.write] = chunk[i];
        this.write = next;
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
      // BLE resumes on an arbitrary waveform sample. Fade back in instead of
      // presenting that discontinuity as a full-scale click.
      this.fadeLeft = this.fadeSamples;
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
      const sample = this.buf[this.read];
      if (this.fadeLeft > 0) {
        const mix = 1 - this.fadeLeft / this.fadeSamples;
        this.lastOut = sample * mix;
        this.fadeLeft--;
      } else {
        this.lastOut = sample;
      }
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
  // BLE delivery is bursty, but the samples themselves always represent the
  // device's nominal clock. Deriving sample rate from packet arrival time makes
  // the resampler chase BLE jitter, periodically draining the queue and popping.
  const sourceStep = sourceRate / ctx.sampleRate;
  let resampleBuffer = new Float32Array(0);
  let sourcePosition = 0;
  // Running amplitude estimate used to spot single-sample decode glitches.
  let rms = 0.01;
  // One-pole DC blocker state (removes per-frame offset steps that click).
  let dcX = 0;
  let dcY = 0;
  let previousSample = 0;

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
    const limit = Math.max(rms * 4, 0.015);
    for (let i = 1; i < f.length - 1; i++) {
      const prev = f[i - 1]!;
      const next = f[i + 1]!;
      const mid = (prev + next) / 2;
      if (Math.abs(f[i]! - mid) > limit) f[i] = mid;
    }
    // Suppress packet-boundary and short multi-sample impulses. Genuine heart
    // and lung energy changes much more slowly at the device's 8 kHz rate.
    const maxStep = Math.max(rms * 1.5, 0.008);
    for (let i = 0; i < f.length; i++) {
      const raw = f[i]!;
      const delta = Math.max(-maxStep, Math.min(maxStep, raw - previousSample));
      const x = previousSample + delta;
      previousSample = x;
      dcY = x - dcX + 0.995 * dcY;
      dcX = x;
      f[i] = dcY;
    }
    return f;
  };

  return {
    node,
    push(pcm) {
      const src = clean(pcm);
      const joined = new Float32Array(resampleBuffer.length + src.length);
      joined.set(resampleBuffer);
      joined.set(src, resampleBuffer.length);
      resampleBuffer = joined;

      // Keep one source sample ahead for interpolation. Retaining the last
      // consumed sample and fractional phase makes adjacent BLE frames one
      // continuous waveform rather than restarting interpolation per packet.
      const output: number[] = [];
      while (sourcePosition + 1 < resampleBuffer.length) {
        const i0 = Math.floor(sourcePosition);
        const frac = sourcePosition - i0;
        const a = resampleBuffer[i0] ?? 0;
        const b = resampleBuffer[i0 + 1] ?? a;
        output.push(a + (b - a) * frac);
        sourcePosition += sourceStep;
      }
      const consumed = Math.floor(sourcePosition);
      if (consumed > 0) {
        resampleBuffer = resampleBuffer.slice(consumed);
        sourcePosition -= consumed;
      }
      const out = Float32Array.from(output);
      node.port.postMessage(out);
    },
    flush() {
      node.port.postMessage("flush");
      resampleBuffer = new Float32Array(0);
      sourcePosition = 0;
      rms = 0.01;
      dcX = 0;
      dcY = 0;
      previousSample = 0;
    },
    dispose() {
      node.port.postMessage("flush");
      node.disconnect();
    },
  };
}
