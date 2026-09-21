import { useEffect, useRef } from "react";

/** Live oscilloscope trace of the auscultation signal. */
export function Waveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    /** Scrolling min/max envelope keeps short S1/S2 sounds visible. */
    const history: Array<[number, number]> = [];
    const COLUMNS = 360;
    const data = analyser ? new Uint8Array(analyser.fftSize) : null;

    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const background = color("--monitor-background", "#06110d");
    const trace = color("--monitor-trace", "#43f58b");
    const glow = color("--monitor-glow", "rgba(67, 245, 139, 0.28)");
    const minorGrid = color("--monitor-grid-minor", "rgba(67, 245, 139, 0.08)");
    const majorGrid = color("--monitor-grid-major", "rgba(67, 245, 139, 0.18)");
    const baseline = color("--monitor-baseline", "rgba(67, 245, 139, 0.3)");
    let displayGain = 1;

    const render = () => {
      raf = requestAnimationFrame(render);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      // Clinical monitor grid: faint minor squares with stronger major divisions.
      const minor = 12;
      for (let x = minor; x < w; x += minor) {
        ctx.strokeStyle = x % (minor * 5) === 0 ? majorGrid : minorGrid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = minor; y < h; y += minor) {
        ctx.strokeStyle = y % (minor * 5) === 0 ? majorGrid : minorGrid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const mid = h / 2;
      ctx.strokeStyle = baseline;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();

      if (analyser && data && active) {
        analyser.getByteTimeDomainData(data as unknown as Uint8Array<ArrayBuffer>);
        let lo = 1;
        let hi = -1;
        for (let i = 0; i < data.length; i++) {
          const v = ((data[i] ?? 128) - 128) / 128;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const peak = Math.max(Math.abs(lo), Math.abs(hi));
        const targetGain = Math.min(12, Math.max(1, 0.62 / Math.max(peak, 0.006)));
        displayGain += (targetGain - displayGain) * 0.08;
        history.push([lo * displayGain, hi * displayGain]);
      } else {
        history.push([0, 0]);
      }
      while (history.length > COLUMNS) history.shift();

      const colW = w / COLUMNS;
      const start = COLUMNS - history.length;
      ctx.save();
      ctx.strokeStyle = trace;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.shadowColor = glow;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const [lo, hi] = history[i] as [number, number];
        const x = (start + i) * colW;
        const yTop = mid - Math.max(-1, Math.min(1, hi)) * mid * 0.78;
        const yBottom = mid - Math.max(-1, Math.min(1, lo)) * mid * 0.78;
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, yBottom);
      }
      ctx.stroke();
      ctx.restore();
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return (
    <div className="relative h-full min-h-28 overflow-hidden rounded-md border border-success/30 bg-navy-900">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-label="Live auscultation waveform" />
      <div className="pointer-events-none absolute left-2 top-1.5 flex items-center gap-1.5 font-mono text-[10px] font-semibold text-success">
        <span className={`size-1.5 rounded-full ${active && analyser ? "animate-pulse bg-success" : "bg-muted-foreground"}`} />
        {active && analyser ? "LIVE AUSCULTATION" : "AWAITING SIGNAL"}
      </div>
      <div className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[9px] text-success/70">
        25 mm/s · AUTO GAIN
      </div>
    </div>
  );
}