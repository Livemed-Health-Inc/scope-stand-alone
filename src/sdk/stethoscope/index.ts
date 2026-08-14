/** Headless stethoscope SDK — no React, no DOM framework. */
export {
  StethoscopeClient,
  DEFAULT_SETTINGS,
  type StethoscopeClientOptions,
  type StethoscopeSettings,
  type StethoscopeState,
  type LinkStatus,
} from "./core/client";
export { MODE_FILTERS, type AuscultationMode, type StethoscopeAdapter } from "./core/transport/types";
export {
  MINTTI_SAMPLE_RATE,
  DEFAULT_PCM_FORMAT,
  hasNativeHost,
  type AudioChannel,
  type GattCharInfo,
  type MinttiDevice,
  type PcmFormat,
  type TransportKind,
} from "./core/transport/mintti";
export { hasWebBluetooth } from "./core/transport/webble";
export { encodeWav } from "./core/transport/wav";
export { createAudioGraph, applyMode, disposeGraph, type AudioGraph } from "./core/audio-graph";
export { startBeatTracker } from "./core/beat-tracker";
