import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isDemoAudioHost, renderHeartCycle, startDemoHeart } from "./demoHeart";

describe("production gating", () => {
  it("allows preview hosts only", () => {
    expect(isDemoAudioHost("id-preview--28d15c76-d24b-45fb-86f5-8f9f6ca480b0.lovable.app")).toBe(true);
    expect(isDemoAudioHost("project--28d15c76-dev.lovable.app")).toBe(true);
    expect(isDemoAudioHost("localhost")).toBe(true);
  });
  it("blocks published and custom domains", () => {
    expect(isDemoAudioHost("scope-stand-alone.lovable.app")).toBe(false);
    expect(isDemoAudioHost("project--28d15c76.lovable.app")).toBe(false);
    expect(isDemoAudioHost("virtualisconsult.com")).toBe(false);
    expect(isDemoAudioHost("www.virtualisconsult.com")).toBe(false);
    expect(isDemoAudioHost("id-preview--x.lovable.app.evil.com")).toBe(false);
  });
});

describe("synthetic signal", () => {
  it("renders one 72 BPM cycle with audible S1/S2", () => {
    const pcm = renderHeartCycle(48000, 72);
    expect(pcm.length).toBe(40000);
    const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(1);
  });
});

function fakeCtx() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const src = { ...node(), start: vi.fn(), stop: vi.fn(), loop: false, buffer: null as unknown };
  const analyser = { ...node(), fftSize: 0, smoothingTimeConstant: 0 };
  const gain = { ...node(), gain: { value: 0 } };
  const ctx = {
    sampleRate: 8000,
    destination: { id: "dest" },
    createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
    createBufferSource: vi.fn(() => src),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => gain),
    createMediaStreamDestination: vi.fn(),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  return { ctx, src, analyser, gain };
}

describe("lifecycle and source separation", () => {
  it("starts only when called, feeds speakers + analyser from one source, and releases on stop", () => {
    const f = fakeCtx();
    const Ctor = vi.fn(function () {
      return f.ctx;
    }) as unknown as new () => AudioContext;
    expect(f.src.start).not.toHaveBeenCalled();
    const h = startDemoHeart(Ctor);
    expect(f.src.start).toHaveBeenCalledTimes(1);
    expect(f.src.loop).toBe(true);
    expect(f.src.connect).toHaveBeenCalledWith(f.analyser);
    expect(f.src.connect).toHaveBeenCalledWith(f.gain);
    expect(f.gain.connect).toHaveBeenCalledWith(f.ctx.destination);
    expect(h.analyser).toBe(f.analyser);
    // Never turned into a MediaStream, so it cannot reach WebRTC.
    expect(f.ctx.createMediaStreamDestination).not.toHaveBeenCalled();
    h.stop();
    h.stop();
    expect(f.src.stop).toHaveBeenCalledTimes(1);
    expect(f.ctx.close).toHaveBeenCalledTimes(1);
  });

  it("demo module never touches mic, Bluetooth, network or the call link", () => {
    const code = readFileSync(new URL("./demoHeart.ts", import.meta.url), "utf8");
    for (const bad of ["getUserMedia", "bluetooth", "fetch(", "MediaStream(", "useAuscultationLink"]) {
      expect(code).not.toContain(bad);
    }
  });
});
