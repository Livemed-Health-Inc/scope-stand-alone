import { useEffect, useRef } from "react";

/** Frequency-band bars showing where energy sits in the auscultation signal. */
export function Spectrum({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const css = getComputedStyle(document.documentElement);
    const bar = `oklch(${css.getPropertyValue("--trace").trim()})`;
    const dim = `oklch(${css.getPropertyValue("--grid").trim()})`;

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

      const bars = 48;
      const bw = w / bars;
      if (analyser && data && active) {
        analyser.getByteFrequencyData(data as unknown as Uint8Array<ArrayBuffer>);
      }
      for (let i = 0; i < bars; i++) {
        // low frequencies matter most for auscultation: sample the bottom of the spectrum
        const idx = Math.floor(Math.pow(i / bars, 1.6) * ((data?.length ?? bars) / 6));
        const v = data && active ? (data[idx] ?? 0) / 255 : 0;
        const bh = Math.max(2, v * h);
        ctx.fillStyle = v > 0.02 ? bar : dim;
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-label="Frequency spectrum" />;
}