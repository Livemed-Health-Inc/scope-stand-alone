import { useCallback, useEffect, useRef, useState } from "react";
import { isDemoAudioHost, startDemoHeart, type DemoHeartHandle } from "./demoHeart";

/** Preview-only demo heart-sound controller. Never auto-starts. */
export function useDemoHeart(enabled: boolean) {
  const [available, setAvailable] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const handle = useRef<DemoHeartHandle | null>(null);

  useEffect(() => {
    setAvailable(isDemoAudioHost(window.location.hostname));
  }, []);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setAnalyser(null);
  }, []);

  const start = useCallback(() => {
    if (!isDemoAudioHost(window.location.hostname) || handle.current) return;
    handle.current = startDemoHeart();
    setAnalyser(handle.current.analyser);
  }, []);

  // Stop when the panel collapses, and release on unmount / call end.
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  useEffect(() => stop, [stop]);

  return { available, playing: !!analyser, analyser, start, stop };
}
