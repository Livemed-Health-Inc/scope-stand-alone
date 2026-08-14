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
    /** Scrolling min/max envelope so short heart sounds stay visible. */
    const history: Array<[number, number]> = [];
    const COLUMNS = 320;
    const data = analyser ? new Uint8Array(analyser.fftSize) : null;

    const css = getComputedStyle(document.documentElement);
    const trace = `oklch(${css.getPropertyValue("--trace").trim()})`;
    const grid = `oklch(${css.getPropertyValue("--grid").trim()})`;

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
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      if (analyser && data && active) {
        analyser.getByteTimeDomainData(data as unknown as Uint8Array<ArrayBuffer>);
        let lo = 1;
        let hi = -1;
        for (let i = 0; i < data.length; i++) {
          const v = ((data[i] ?? 128) - 128) / 128;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        history.push([lo, hi]);
      } else {
        history.push([0, 0]);
      }
      while (history.length > COLUMNS) history.shift();

      const colW = w / COLUMNS;
      ctx.fillStyle = trace;
      const mid = h / 2;
      const start = COLUMNS - history.length;
      for (let i = 0; i < history.length; i++) {
        const [lo, hi] = history[i] as [number, number];
        const yTop = mid - hi * mid * 0.92;
        const yBot = mid - lo * mid * 0.92;
        ctx.fillRect((start + i) * colW, yTop, Math.max(1, colW), Math.max(2, yBot - yTop));
      }
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-label="Live auscultation waveform" />;
}