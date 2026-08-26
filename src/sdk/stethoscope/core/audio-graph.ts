/**
 * The tuned auscultation audio chain, validated against real Mintti Smartho
 * hardware. Framework-agnostic: give it an AudioContext, get back the graph.
 */
import { createPcmStreamNode, type PcmStreamNode } from "./transport/pcm-stream";
import { MINTTI_SAMPLE_RATE } from "./transport/mintti";
import { MODE_FILTERS, type AuscultationMode } from "./transport/types";

export interface AudioGraph {
  ctx: AudioContext;
  pcm: PcmStreamNode;
  hp: BiquadFilterNode;
  hp2: BiquadFilterNode;
  lp: BiquadFilterNode;
  lp2: BiquadFilterNode;
  lp3: BiquadFilterNode;
  heartPeak: BiquadFilterNode;
  shelf: BiquadFilterNode;
  makeup: GainNode;
  gate: GainNode;
  detectAnalyser: AnalyserNode;
  gain: GainNode;
  monitor: GainNode;
  analyser: AnalyserNode;
  broadcast: MediaStreamAudioDestinationNode;
}

export interface GraphSettings {
  mode: AuscultationMode;
  gain: number;
  bass: number;
  monitoring: boolean;
}

export async function createAudioGraph(s: GraphSettings): Promise<AudioGraph> {
  const ctx = new AudioContext();
  await ctx.resume();
  const pcm = await createPcmStreamNode(ctx, MINTTI_SAMPLE_RATE);

  const band = MODE_FILTERS[s.mode];
  const biquad = (type: BiquadFilterType, freq: number, q: number, gain?: number) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = freq;
    n.Q.value = q;
    if (gain !== undefined) n.gain.value = gain;
    return n;
  };

  const hp = biquad("highpass", band.low, 0.7);
  // A second highpass pole removes handling rumble and DC wander that swamp S1/S2.
  const hp2 = biquad("highpass", band.low, 0.7);
  const lp = biquad("lowpass", band.high, 0.9);
  const lp2 = biquad("lowpass", band.high, 0.9);
  // Third pole sits above the band: keeps voice out without dulling S1/S2.
  const lp3 = biquad("lowpass", band.high * 1.6, 0.6);
  // Gentle lift around the S1/S2 body keeps thumps distinct without booming.
  const heartPeak = biquad("peaking", 70, 0.6, s.mode === "bell" ? 8 : 0);
  // Mains hum sits inside the heart band and is the usual "muddy buzz".
  const hum50 = biquad("notch", 50, 8);
  const hum60 = biquad("notch", 60, 8);
  const shelf = biquad("lowshelf", 150, 0.7, s.bass);
  // Cut the boomy band that smears S1 into S2 and hides the "lub-dub" gap.
  const deMud = biquad("peaking", 130, 1.4, -4);
  // Small lift on the S1/S2 attack so each thump has a defined edge.
  const clarity = biquad("peaking", 42, 1.2, 3);
  // Definition lift on the upper body of S1/S2 — reads as a crisp "lub-dub".
  const edge = biquad("peaking", 175, 0.9, 4);

  // Transparent output limiter only; heavy compression raises packet noise.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -3;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.006;
  comp.release.value = 0.25;

  const makeup = ctx.createGain();
  makeup.gain.value = 1;
  // Lookahead so the gate is open before the transient arrives.
  const lookahead = ctx.createDelay(0.2);
  lookahead.delayTime.value = 0.06;

  // Linear shaper: a tanh curve here made clean low thumps sound fuzzy.
  const softClip = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = (i / (curve.length - 1)) * 2 - 1;
  softClip.curve = curve;
  softClip.oversample = "4x";

  // Small speakers cannot reproduce 20-80 Hz. A parallel harmonic path adds the
  // overtones of each thump so phones/laptops render a crisp "lub-dub".
  // Kept gentle and band-limited: aggressive squaring generated high harmonics
  // that the remote Opus encoder turned into sharp static on the doctor side.
  const harmShaper = ctx.createWaveShaper();
  const hc = new Float32Array(1024);
  for (let i = 0; i < hc.length; i++) {
    const x = (i / (hc.length - 1)) * 2 - 1;
    hc[i] = x * x * Math.sign(x) * 0.55 + x * 0.45;
  }
  harmShaper.curve = hc;
  harmShaper.oversample = "4x";
  const harmBand = biquad("bandpass", 170, 0.7);
  // Hard ceiling on the harmonic path so no fizz above the heart band escapes.
  const harmTame = biquad("lowpass", 320, 0.7);
  const harmGain = ctx.createGain();
  harmGain.gain.value = 0.3;


  const gate = ctx.createGain();
  gate.gain.value = 1;

  // Dedicated detection tap: narrow S1/S2 band (25-70 Hz) taken before the
  // compressor so voices, rubbing and hiss cannot fake a beat.
  const detHp = biquad("highpass", 25, 0.7);
  const detLp = biquad("lowpass", 70, 0.7);
  const detLp2 = biquad("lowpass", 70, 0.7);
  const detectAnalyser = ctx.createAnalyser();
  detectAnalyser.fftSize = 1024;
  detectAnalyser.smoothingTimeConstant = 0;

  const gain = ctx.createGain();
  gain.gain.value = s.gain;
  const monitor = ctx.createGain();
  monitor.gain.value = s.monitoring ? 1 : 0;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.7;
  const broadcast = ctx.createMediaStreamDestination();

  pcm.node.connect(hp);
  hp.connect(hp2);
  hp2.connect(lp);
  lp.connect(lp2);
  lp2.connect(lp3);
  lp3.connect(hum50);
  hum50.connect(hum60);
  hum60.connect(heartPeak);
  heartPeak.connect(deMud);
  deMud.connect(clarity);
  clarity.connect(edge);
  edge.connect(shelf);
  shelf.connect(makeup);
  makeup.connect(lookahead);
  lookahead.connect(gate);
  hum60.connect(detHp);
  detHp.connect(detLp);
  detLp.connect(detLp2);
  detLp2.connect(detectAnalyser);
  gate.connect(comp);
  comp.connect(softClip);
  softClip.connect(gain);
  softClip.connect(harmShaper);
  harmShaper.connect(harmBand);
  harmBand.connect(harmTame);
  harmTame.connect(harmGain);
  harmGain.connect(gain);

  gain.connect(analyser);
  gain.connect(broadcast);
  gain.connect(monitor);
  monitor.connect(ctx.destination);

  return {
    ctx, pcm, hp, hp2, lp, lp2, lp3, heartPeak, shelf, makeup, gate,
    detectAnalyser, gain, monitor, analyser, broadcast,
  };
}

/** Re-point the band filters when the auscultation mode changes. */
export function applyMode(g: AudioGraph, mode: AuscultationMode) {
  const band = MODE_FILTERS[mode];
  g.hp.frequency.value = band.low;
  g.hp2.frequency.value = band.low;
  g.lp.frequency.value = band.high;
  g.lp2.frequency.value = band.high;
  g.lp3.frequency.value = band.high * 1.6;
  g.heartPeak.gain.value = mode === "bell" ? 8 : 0;
}

export function disposeGraph(g: AudioGraph) {
  g.pcm.dispose();
  void g.ctx.close().catch(() => undefined);
}
