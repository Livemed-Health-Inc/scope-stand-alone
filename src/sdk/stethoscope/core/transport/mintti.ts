/**
 * Transport layer for the Mintti Smartho SDK (MinttiSmarthoSDK iOS framework v1.1.6).
 *
 * The vendor SDK is a native iOS BLE framework, so it cannot run inside a browser.
 * The web app talks to it through a thin host bridge: an iOS app embeds this site in
 * a WKWebView, forwards `MinttiBleManagerDelegate` callbacks into the page, and
 * executes commands coming back out. See `docs/mintti-ios-bridge.md`.
 *
 * Device audio: 8 kHz, 16-bit signed little-endian PCM, mono (SDK doc, section V).
 */

export const MINTTI_SAMPLE_RATE = 8000;

/** Mirrors ECHO_MODE in MinttiBleManager.h */
export type EchoMode = "bell" | "diaphragm";
export const ECHO_MODE_CODE: Record<EchoMode, 0 | 1> = { bell: 0, diaphragm: 1 };

/** Which of the three SDK audio callbacks to render. */
export type AudioChannel = "result" | "mic" | "spk";

export interface MinttiDevice {
  uuid: string;
  name: string;
  rssi: number;
}

/** One discovered GATT characteristic, used by the Web Bluetooth inspector. */
export interface GattCharInfo {
  id: string;
  service: string;
  characteristic: string;
  notifying: boolean;
  packets: number;
  lastBytes: number;
  bytesPerSec: number;
  /** True when the characteristic accepts writes (candidate control channel). */
  writable?: boolean;
  /** Hex preview of the most recent notification payload (first 16 bytes). */
  hex?: string;
}

/** How raw GATT payload bytes are turned into PCM samples. */
export interface PcmFormat {
  /**
   * "ima" = vendor IMA-ADPCM frames (what the Smartho actually streams);
   * "raw" = treat the payload as linear PCM (manual override).
   */
  codec: "ima" | "raw";
  /** Bytes to drop from the start of each packet (frame header). */
  skipBytes: number;
  /** Sample byte order. */
  bigEndian: boolean;
  /** 8-bit unsigned samples instead of 16-bit signed. */
  eightBit: boolean;
  /** ADPCM nibble order: false = high nibble first (vendor default). */
  lowNibbleFirst?: boolean;
  /** Which compressed sensor block to monitor. Auto favors low-frequency chest energy. */
  sensorChannel?: "auto" | "chest" | "reference";
}

export const DEFAULT_PCM_FORMAT: PcmFormat = {
  codec: "ima",
  skipBytes: 0,
  bigEndian: false,
  eightBit: false,
  lowNibbleFirst: false,
  sensorChannel: "chest",
};

export type MinttiEvent =
  | { type: "bleState"; available: boolean }
  | { type: "scanResult"; uuid: string; name: string; rssi: number }
  | { type: "connectState"; connected: boolean }
  | { type: "audio"; channel: AudioChannel; pcm: Int16Array }
  | { type: "battery"; level: number }
  | { type: "version"; version: string }
  | { type: "param"; param: number }
  | { type: "echoMode"; mode: EchoMode }
  | { type: "heartRate"; bpm: number }
  | { type: "captureState"; capturing: boolean }
  | { type: "pressTooBig" }
  | { type: "gatt"; chars: GattCharInfo[]; audioId: string | null }
  | { type: "diag"; message: string }
  | { type: "transportError"; message: string };

export type MinttiCommand =
  | { cmd: "startScan" }
  | { cmd: "stopScan" }
  | { cmd: "autoPair" }
  | { cmd: "connect"; uuid: string }
  | { cmd: "disconnect" }
  | { cmd: "startAudio" }
  | { cmd: "stopAudio" }
  | { cmd: "setEchoMode"; mode: 0 | 1 }
  | { cmd: "readBattery" }
  | { cmd: "readVersion" }
  | { cmd: "selectAudioChar"; id: string }
  | { cmd: "setPcmFormat"; format: PcmFormat }
  | { cmd: "wake" };

export interface MinttiTransport {
  /** "native" = iOS host bridge, "webble" = direct Web Bluetooth, "simulator" = demo. */
  kind: TransportKind;
  send(command: MinttiCommand): void;
  subscribe(listener: (event: MinttiEvent) => void): () => void;
  dispose(): void;
}

export type TransportKind = "native" | "webble" | "simulator";

/* ------------------------------------------------------------------ native */

interface WebkitHost {
  webkit?: { messageHandlers?: Record<string, { postMessage(body: unknown): void } | undefined> };
}

export function hasNativeHost(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as WebkitHost & { MinttiHost?: unknown };
  return Boolean(w.webkit?.messageHandlers?.['mintti'] || w.MinttiHost);
}

/** Decodes base64 16-bit LE PCM coming from the native side. */
function decodePcm(base64: string): Int16Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

export function createNativeTransport(): MinttiTransport {
  const listeners = new Set<(e: MinttiEvent) => void>();
  const w = window as unknown as WebkitHost & {
    MinttiHost?: { postMessage?: (s: string) => void };
    __minttiEmit?: (raw: unknown) => void;
  };

  // The native layer calls window.__minttiEmit(payload) for every delegate callback.
  w.__minttiEmit = (raw: unknown) => {
    const msg = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    if (!msg || typeof msg['type'] !== "string") return;
    const event =
      msg['type'] === "audio"
        ? ({
            type: "audio",
            channel: (msg['channel'] as AudioChannel) ?? "result",
            pcm: decodePcm(String(msg['pcm'] ?? "")),
          } satisfies MinttiEvent)
        : (msg as unknown as MinttiEvent);
    listeners.forEach((l) => l(event));
  };

  return {
    kind: "native",
    send(command) {
      const handler = w.webkit?.messageHandlers?.['mintti'];
      if (handler) handler.postMessage(command);
      else w.MinttiHost?.postMessage?.(JSON.stringify(command));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      delete w.__minttiEmit;
    },
  };
}

/* --------------------------------------------------------------- simulator */

/**
 * Emulates the Smartho delegate stream (8 kHz Int16 frames, HR, battery, press
 * warnings) so the whole UI is exercisable in a desktop browser.
 */
export function createSimulatorTransport(): MinttiTransport {
  const listeners = new Set<(e: MinttiEvent) => void>();
  const emit = (e: MinttiEvent) => listeners.forEach((l) => l(e));
  const timers: number[] = [];
  let connected = false;
  let capturing = false;
  let echo: EchoMode = "bell";
  let audioTimer: number | null = null;
  let phase = 0;

  const FRAME = 400; // 50 ms at 8 kHz

  const frame = () => {
    const pcm = new Int16Array(FRAME);
    const beat = 0.85; // ~70 bpm
    for (let i = 0; i < FRAME; i++) {
      const t = phase / MINTTI_SAMPLE_RATE;
      const p = t % beat;
      let s = 0;
      if (p < 0.16) s += 0.9 * Math.sin(2 * Math.PI * 46 * p) * Math.exp(-p * 34);
      const p2 = p - 0.34;
      if (p2 > 0 && p2 < 0.12) s += 0.55 * Math.sin(2 * Math.PI * 68 * p2) * Math.exp(-p2 * 48);
      const breath = Math.max(0, Math.sin((2 * Math.PI * t) / 4));
      s += (Math.random() * 2 - 1) * (echo === "diaphragm" ? 0.1 : 0.05) * breath;
      pcm[i] = Math.max(-1, Math.min(1, s * 0.8)) * 32767;
      phase++;
    }
    return pcm;
  };

  const startAudio = () => {
    if (audioTimer !== null) return;
    capturing = true;
    emit({ type: "captureState", capturing: true });
    audioTimer = window.setInterval(() => {
      emit({ type: "audio", channel: "result", pcm: frame() });
    }, 50);
    timers.push(
      window.setInterval(() => emit({ type: "heartRate", bpm: 68 + Math.round(Math.random() * 8) }), 3000),
    );
  };

  return {
    kind: "simulator",
    send(command) {
      switch (command.cmd) {
        case "startScan":
          emit({ type: "bleState", available: true });
          window.setTimeout(
            () => emit({ type: "scanResult", uuid: "SIM-0001-SMARTHO", name: "Smartho-P (demo)", rssi: -52 }),
            400,
          );
          window.setTimeout(
            () => emit({ type: "scanResult", uuid: "SIM-0002-SMARTHO", name: "Smartho-P (demo 2)", rssi: -71 }),
            1100,
          );
          break;
        case "connect":
          window.setTimeout(() => {
            connected = true;
            emit({ type: "connectState", connected: true });
            emit({ type: "version", version: "1.1.6-sim" });
            emit({ type: "battery", level: 87 });
            emit({ type: "echoMode", mode: echo });
          }, 500);
          break;
        case "disconnect":
          connected = false;
          capturing = false;
          if (audioTimer !== null) window.clearInterval(audioTimer);
          audioTimer = null;
          emit({ type: "connectState", connected: false });
          break;
        case "startAudio":
          if (connected) startAudio();
          break;
        case "stopAudio":
          if (audioTimer !== null) window.clearInterval(audioTimer);
          audioTimer = null;
          capturing = false;
          emit({ type: "captureState", capturing: false });
          break;
        case "setEchoMode":
          echo = command.mode === 1 ? "diaphragm" : "bell";
          emit({ type: "echoMode", mode: echo });
          break;
        case "readBattery":
          emit({ type: "battery", level: 87 });
          break;
        case "readVersion":
          emit({ type: "version", version: "1.1.6-sim" });
          break;
        default:
          break;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (audioTimer !== null) window.clearInterval(audioTimer);
      timers.forEach((t) => window.clearInterval(t));
      listeners.clear();
    },
  };
}

export async function createMinttiTransport(preferred?: TransportKind): Promise<MinttiTransport> {
  const kind: TransportKind =
    preferred ?? (hasNativeHost() ? "native" : "simulator");
  if (kind === "native") return createNativeTransport();
  if (kind === "webble") {
    const { createWebBluetoothTransport } = await import("./webble");
    return createWebBluetoothTransport();
  }
  return createSimulatorTransport();
}
