import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "virtualis.cameraId";

export type CameraDevice = { deviceId: string; label: string };

/**
 * Tracks the video input devices attached to this machine (built-in webcam,
 * USB/HDMI capture cards, exam cameras, otoscopes…) and remembers the last
 * camera the clinician picked.
 */
export function useCameraDevices(ready: boolean) {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraId, setCameraIdState] = useState<string | null>(null);
  const [preferenceReady, setPreferenceReady] = useState(false);

  useEffect(() => {
    try {
      setCameraIdState(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* storage unavailable */
    } finally {
      setPreferenceReady(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      setCameras(cams);
      // Selected camera was unplugged — fall back to the default one.
      setCameraIdState((cur) => (cur && !cams.some((c) => c.deviceId === cur) ? null : cur));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [ready, refresh]);

  const setCameraId = useCallback((id: string | null) => {
    setCameraIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return { cameras, cameraId, preferenceReady, setCameraId, refresh };
}
