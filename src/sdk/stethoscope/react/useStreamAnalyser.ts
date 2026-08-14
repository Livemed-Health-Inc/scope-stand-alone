import { useEffect, useState } from "react";

/**
 * Builds an AnalyserNode for any MediaStream (local stethoscope feed or a
 * remote peer's audio) so a waveform can be drawn on either end of a call.
 */
export function useStreamAnalyser(stream: MediaStream | null): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setAnalyser(null);
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createAnalyser();
    node.fftSize = 2048;
    node.smoothingTimeConstant = 0.7;
    src.connect(node);
    // Keep the graph pulling samples without making noise.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);
    void ctx.resume().catch(() => {});
    setAnalyser(node);
    return () => {
      setAnalyser(null);
      src.disconnect();
      node.disconnect();
      sink.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [stream]);

  return analyser;
}
