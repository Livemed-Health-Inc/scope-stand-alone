/**
 * Live beat follower + automatic level rider.
 *
 * Tracks the quiet floor in the 25-70 Hz S1/S2 band, reports BPM, ducks between
 * beats and rides the makeup gain so every thump lands at a consistent level.
 */
import type { AudioGraph } from "./audio-graph";

export interface BeatTrackerOptions {
  denoise: () => boolean;
  beatBoost: () => number;
  onBpm: (bpm: number | null) => void;
  onBeat: () => void;
}

const TARGET_PEAK = 0.18;

export function startBeatTracker(g: AudioGraph, o: BeatTrackerOptions): () => void {
  let raf = 0;
  let fast = 0;
  let floor = 0.002;
  let peak = 0.01;
  let armed = true;
  let lastBeat = 0;
  let lastCandidate = 0;
  let auto = 1;
  const intervals: number[] = [];
  const det = new Float32Array(1024);

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    g.detectAnalyser.getFloatTimeDomainData(det);
    let sum = 0;
    for (let i = 0; i < det.length; i++) sum += det[i]! * det[i]!;
    const rms = Math.sqrt(sum / det.length);

    // Quick attack, slow release: one noisy frame cannot spike the detector.
    fast = rms > fast ? fast * 0.5 + rms * 0.5 : fast * 0.85 + rms * 0.15;
    floor = fast < floor ? floor * 0.9 + fast * 0.1 : floor * 0.999 + fast * 0.001;
    peak = fast > peak ? fast : peak * 0.997 + fast * 0.003;

    const span = Math.max(peak - floor, 1e-6);
    const hi = floor + span * 0.45;
    const lo = floor + span * 0.2; // hysteresis before re-arming

    const now = performance.now();
    const expected = intervals.length >= 3 ? median(intervals) : 0;
    const refractory = expected ? Math.max(250, expected * 0.45) : 300;

    if (fast < lo) armed = true;

    const strong = fast > hi && fast > floor * 2.5 && fast > 0.0012;
    if (armed && strong && now - lastBeat > refractory) {
      const delta = lastBeat ? now - lastBeat : 0;
      armed = false;
      if (delta > 300 && delta < 2000) {
        // A lone outlier is noise; two in a row means the rhythm changed.
        const fits = !expected || Math.abs(delta - expected) < expected * 0.35;
        if (fits || now - lastCandidate < 2500) {
          intervals.push(delta);
          if (intervals.length > 10) intervals.shift();
          if (intervals.length >= 3) o.onBpm(Math.round(60000 / median(intervals)));
          lastBeat = now;
          o.onBeat();
        } else {
          lastCandidate = now;
        }
      } else {
        lastBeat = now;
        o.onBeat();
      }
    }

    const beatWindow = now - lastBeat < 260;
    const open = beatWindow || fast > lo;

    // Only re-level from real signal; silence must not pump the gain up.
    if (peak > 1e-4) {
      // Large automatic boosts expose the device noise floor and turn tiny BLE
      // discontinuities into loud ticks. Eight-fold gain is ample for S1/S2.
      const wanted = Math.min(Math.max(TARGET_PEAK / peak, 1), 8);
      auto = wanted > auto ? auto * 0.995 + wanted * 0.005 : auto * 0.9 + wanted * 0.1;
      g.makeup.gain.setTargetAtTime(auto, g.ctx.currentTime, 0.25);
    }

    // A deep gate chops the tail of a thump and reads as distortion, so between
    // beats the level only ducks instead of closing.
    const cleanBoost = Math.min(o.beatBoost(), 2);
    const target = o.denoise() ? (beatWindow ? cleanBoost : 0.45) : open ? cleanBoost : 1;
    g.gate.gain.setTargetAtTime(target, g.ctx.currentTime, open ? 0.04 : 0.25);
  };

  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    g.makeup.gain.setTargetAtTime(1, g.ctx.currentTime, 0.05);
  };
}
