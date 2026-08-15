/** Simple WebAudio ringer for incoming consult requests (no asset needed). */
let ctx: AudioContext | null = null;
let timer: number | null = null;

function beep() {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const offset of [0, 0.45]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.4);
  }
}

export function startRinging() {
  if (typeof window === "undefined" || timer !== null) return;
  try {
    ctx = ctx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    void ctx.resume();
  } catch {
    return;
  }
  beep();
  timer = window.setInterval(beep, 2000);
}

export function stopRinging() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

/* ---------- Rounding alert: a distinct, lower two-tone chime ---------- */
let alertTimer: number | null = null;

function chime() {
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [
    { f: 587.33, t: 0 },
    { f: 880, t: 0.22 },
    { f: 587.33, t: 0.44 },
  ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(n.f, now + n.t);
    gain.gain.setValueAtTime(0.0001, now + n.t);
    gain.gain.exponentialRampToValueAtTime(0.3, now + n.t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + n.t);
    osc.stop(now + n.t + 0.35);
  }
}

/** Repeating (but not frantic) alert used for rounding notifications. */
export function startAlerting(intervalMs = 15000) {
  if (typeof window === "undefined" || alertTimer !== null) return;
  try {
    ctx = ctx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    void ctx.resume();
  } catch {
    return;
  }
  chime();
  alertTimer = window.setInterval(chime, intervalMs);
}

export function stopAlerting() {
  if (alertTimer !== null) {
    window.clearInterval(alertTimer);
    alertTimer = null;
  }
}
