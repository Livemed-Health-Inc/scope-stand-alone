/**
 * StethoscopeClient — headless, framework-agnostic controller for a Mintti
 * Smartho digital stethoscope.
 *
 *   const scope = new StethoscopeClient();
 *   scope.subscribe((s) => render(s));
 *   await scope.autoPair();          // or scope.scan() + scope.connect(uuid)
 *   await scope.startCapture();      // heart sounds start flowing
 *   scope.getState().callStream;     // processed MediaStream for WebRTC
 */
import {
  ECHO_MODE_CODE,
  MINTTI_SAMPLE_RATE,
  DEFAULT_PCM_FORMAT,
  createMinttiTransport,
  hasNativeHost,
  type AudioChannel,
  type GattCharInfo,
  type MinttiDevice,
  type MinttiTransport,
  type PcmFormat,
  type TransportKind,
} from "./transport/mintti";
import { hasWebBluetooth, getExtraServices, setExtraServices } from "./transport/webble";
import { encodeWav } from "./transport/wav";
import { MODE_FILTERS, type AuscultationMode } from "./transport/types";
import { createAudioGraph, applyMode, disposeGraph, type AudioGraph } from "./audio-graph";
import { startBeatTracker } from "./beat-tracker";

export type LinkStatus = "idle" | "scanning" | "connecting" | "connected" | "error";

export interface StethoscopeSettings {
  /** Auscultation band: bell = heart, diaphragm = lung, wide = full spectrum. */
  mode: AuscultationMode;
  /** Which decoded sensor stream to listen to. */
  channel: AudioChannel;
  /** Output amplification (1 = unity). */
  gain: number;
  /** Low-shelf lift in dB below 150 Hz. */
  bass: number;
  /** Duck between beats so S1/S2 stand out. */
  denoise: boolean;
  /** Extra lift applied during a detected beat (capped at 2x). */
  beatBoost: number;
  /** Play the processed audio out of this device's speakers. */
  monitoring: boolean;
}

/** Values validated on real hardware — do not raise them without testing. */
export const DEFAULT_SETTINGS: StethoscopeSettings = {
  mode: "bell",
  channel: "result",
  gain: 1,
  bass: 1,
  denoise: true,
  beatBoost: 1,
  monitoring: true,
};

export interface StethoscopeState extends StethoscopeSettings {
  hostKind: TransportKind;
  webBleSupported: boolean;
  bleAvailable: boolean;
  status: LinkStatus;
  connected: boolean;
  error: string | null;
  diag: string | null;
  devices: MinttiDevice[];
  deviceId: string | null;
  capturing: boolean;
  battery: number | null;
  version: string | null;
  /** BPM reported by the device firmware. */
  heartRate: number | null;
  /** BPM measured locally from the live audio. */
  liveBpm: number | null;
  /** Increments on every detected beat — handy for pulse animations. */
  beatTick: number;
  pressWarning: boolean;
  elapsed: number;
  band: (typeof MODE_FILTERS)[AuscultationMode];
  analyser: AnalyserNode | null;
  callStream: MediaStream | null;
  recording: boolean;
  lastClip: { url: string; seconds: number } | null;
  // Low-level diagnostics
  gattChars: GattCharInfo[];
  audioCharId: string | null;
  pcmFormat: PcmFormat;
  packetsSeen: number;
  vendorServices: string[];
}

export interface StethoscopeClientOptions {
  /** Force a transport instead of auto-detecting native / Web Bluetooth. */
  transport?: TransportKind;
  /** Override the hardware-validated defaults. */
  settings?: Partial<StethoscopeSettings>;
}

const isBrowser = typeof window !== "undefined";

export class StethoscopeClient {
  private listeners = new Set<(s: StethoscopeState) => void>();
  private transport: MinttiTransport | null = null;
  private graph: AudioGraph | null = null;
  private record: Int16Array[] | null = null;
  private stopBeats: (() => void) | null = null;
  private timer: number | undefined;
  private kind: TransportKind;
  private state: StethoscopeState;

  constructor(opts: StethoscopeClientOptions = {}) {
    this.kind =
      opts.transport ??
      (hasNativeHost() ? "native" : hasWebBluetooth() ? "webble" : "simulator");
    const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.state = {
      ...settings,
      hostKind: this.kind,
      webBleSupported: hasWebBluetooth(),
      bleAvailable: true,
      status: "idle",
      connected: false,
      error: null,
      diag: null,
      devices: [],
      deviceId: null,
      capturing: false,
      battery: null,
      version: null,
      heartRate: null,
      liveBpm: null,
      beatTick: 0,
      pressWarning: false,
      elapsed: 0,
      band: MODE_FILTERS[settings.mode],
      analyser: null,
      callStream: null,
      recording: false,
      lastClip: null,
      gattChars: [],
      audioCharId: null,
      pcmFormat: DEFAULT_PCM_FORMAT,
      packetsSeen: 0,
      vendorServices: isBrowser ? getExtraServices() : [],
    };
  }

  // ---- store -------------------------------------------------------------

  getState = (): StethoscopeState => this.state;

  subscribe = (fn: (s: StethoscopeState) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<StethoscopeState>) {
    this.state = { ...this.state, ...patch };
    this.state.connected = this.state.status === "connected";
    this.state.band = MODE_FILTERS[this.state.mode];
    this.listeners.forEach((fn) => fn(this.state));
  }

  // ---- settings ----------------------------------------------------------

  update(patch: Partial<StethoscopeSettings>) {
    this.set(patch);
    const g = this.graph;
    if (patch.mode !== undefined) {
      if (g) applyMode(g, patch.mode);
      this.transport?.send({
        cmd: "setEchoMode",
        mode: ECHO_MODE_CODE[patch.mode === "bell" ? "bell" : "diaphragm"],
      });
    }
    if (g) {
      const now = g.ctx.currentTime;
      if (patch.gain !== undefined) g.gain.gain.setTargetAtTime(patch.gain, now, 0.015);
      if (patch.bass !== undefined) g.shelf.gain.setTargetAtTime(patch.bass, now, 0.02);
      if (patch.monitoring !== undefined) {
        g.monitor.gain.setTargetAtTime(patch.monitoring ? 1 : 0, now, 0.01);
      }
    }
  }

  // ---- lifecycle ---------------------------------------------------------

  private async ensureGraph() {
    if (this.graph) return this.graph;
    const { mode, gain, bass, monitoring } = this.state;
    const g = await createAudioGraph({ mode, gain, bass, monitoring });
    this.graph = g;
    this.set({ analyser: g.analyser, callStream: g.broadcast.stream });
    return g;
  }

  private async ensureTransport() {
    if (this.transport) return this.transport;
    const t = await createMinttiTransport(this.kind);
    this.set({ hostKind: t.kind });
    t.subscribe((e) => this.onTransportEvent(e));
    this.transport = t;
    return t;
  }

  private onTransportEvent(e: Parameters<Parameters<MinttiTransport["subscribe"]>[0]>[0]) {
    switch (e.type) {
      case "bleState":
        this.set({ bleAvailable: e.available });
        break;
      case "scanResult": {
        const prev = this.state.devices;
        this.set({
          devices: prev.some((d) => d.uuid === e.uuid)
            ? prev.map((d) => (d.uuid === e.uuid ? { ...d, rssi: e.rssi, name: e.name } : d))
            : [...prev, { uuid: e.uuid, name: e.name, rssi: e.rssi }],
        });
        break;
      }
      case "connectState":
        this.set(
          e.connected
            ? { status: "connected" }
            : { status: "idle", capturing: false, heartRate: null, deviceId: null },
        );
        if (!e.connected) this.onCapturingChange(false);
        break;
      case "audio":
        if (e.channel !== this.state.channel) return;
        this.graph?.pcm.push(e.pcm);
        this.record?.push(new Int16Array(e.pcm));
        break;
      case "battery":
        this.set({ battery: e.level });
        break;
      case "version":
        this.set({ version: e.version });
        break;
      case "heartRate":
        this.set({ heartRate: e.bpm });
        break;
      case "captureState":
        this.set({ capturing: e.capturing });
        this.onCapturingChange(e.capturing);
        break;
      case "pressTooBig":
        this.set({ pressWarning: true });
        window.setTimeout(() => this.set({ pressWarning: false }), 4000);
        break;
      case "gatt":
        this.set({
          gattChars: e.chars,
          audioCharId: e.audioId,
          packetsSeen: e.chars.reduce((n, c) => n + c.packets, 0),
        });
        break;
      case "diag":
        this.set({ diag: e.message });
        break;
      case "transportError":
        this.set({ error: e.message, status: "error" });
        break;
      default:
        break;
    }
  }

  /** Start/stop the beat tracker and elapsed timer with the capture state. */
  private onCapturingChange(capturing: boolean) {
    this.stopBeats?.();
    this.stopBeats = null;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = undefined;
    if (!capturing) {
      this.set({ liveBpm: null });
      return;
    }
    const g = this.graph;
    if (g) {
      this.stopBeats = startBeatTracker(g, {
        denoise: () => this.state.denoise,
        beatBoost: () => this.state.beatBoost,
        onBpm: (bpm) => this.set({ liveBpm: bpm }),
        onBeat: () => this.set({ beatTick: this.state.beatTick + 1 }),
      });
    }
    const started = Date.now();
    this.set({ elapsed: 0 });
    this.timer = window.setInterval(
      () => this.set({ elapsed: Math.floor((Date.now() - started) / 1000) }),
      500,
    );
  }

  // ---- actions -----------------------------------------------------------

  async scan() {
    this.set({ error: null, devices: [], status: "scanning" });
    (await this.ensureTransport()).send({ cmd: "startScan" });
    window.setTimeout(() => {
      if (this.state.status === "scanning") this.set({ status: "idle" });
    }, 8000);
  }

  /** Silently re-attach to a stethoscope the browser already has permission for. */
  async autoPair() {
    try {
      (await this.ensureTransport()).send({ cmd: "autoPair" });
    } catch {
      /* no remembered device — the user pairs manually */
    }
  }

  async connect(uuid: string) {
    this.set({ error: null, deviceId: uuid, status: "connecting" });
    const t = await this.ensureTransport();
    t.send({ cmd: "stopScan" });
    try {
      await this.ensureGraph();
    } catch (e) {
      this.set({
        status: "error",
        error: e instanceof Error ? e.message : "Audio engine failed to start.",
      });
      return;
    }
    t.send({ cmd: "connect", uuid });
    t.send({ cmd: "readVersion" });
    t.send({ cmd: "readBattery" });
  }

  disconnect() {
    this.transport?.send({ cmd: "stopAudio" });
    this.transport?.send({ cmd: "disconnect" });
    this.graph?.pcm.flush();
    this.set({ capturing: false, status: "idle" });
    this.onCapturingChange(false);
  }

  async startCapture() {
    const g = await this.ensureGraph();
    await g.ctx.resume();
    g.pcm.flush();
    this.transport?.send({
      cmd: "setEchoMode",
      mode: ECHO_MODE_CODE[this.state.mode === "bell" ? "bell" : "diaphragm"],
    });
    this.transport?.send({ cmd: "startAudio" });
  }

  stopCapture() {
    this.transport?.send({ cmd: "stopAudio" });
  }

  startRecording() {
    this.record = [];
    this.set({ recording: true, lastClip: null });
  }

  /** Stops recording and returns a WAV clip of the raw device audio. */
  stopRecording(): { url: string; seconds: number } | null {
    const chunks = this.record ?? [];
    this.record = null;
    this.set({ recording: false });
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (!total) return null;
    const merged = new Int16Array(total);
    let o = 0;
    for (const c of chunks) {
      merged.set(c, o);
      o += c.length;
    }
    const blob = encodeWav(merged, MINTTI_SAMPLE_RATE);
    const clip = { url: URL.createObjectURL(blob), seconds: total / MINTTI_SAMPLE_RATE };
    this.set({ lastClip: clip });
    return clip;
  }

  // ---- low-level / diagnostics -------------------------------------------

  selectAudioChar(id: string) {
    this.transport?.send({ cmd: "selectAudioChar", id });
    this.set({ audioCharId: id });
  }

  /** Change how raw BLE bytes are read as PCM (header skip, endianness, depth). */
  setPcmFormat(patch: Partial<PcmFormat>) {
    const next = { ...this.state.pcmFormat, ...patch };
    this.transport?.send({ cmd: "setPcmFormat", format: next });
    this.graph?.pcm.flush();
    this.set({ pcmFormat: next });
  }

  /** Re-send the start-streaming opcodes to the writable characteristics. */
  wakeDevice() {
    this.transport?.send({ cmd: "wake" });
  }

  /** Whitelist an extra vendor GATT service so Web Bluetooth can expose it. */
  addVendorService(uuid: string) {
    const clean = uuid.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) {
      this.set({ error: "Enter a full 128-bit UUID, e.g. 0000fff0-0000-1000-8000-00805f9b34fb" });
      return;
    }
    const next = [...new Set([...getExtraServices(), clean])];
    setExtraServices(next);
    this.set({
      vendorServices: next,
      error: null,
      diag: "Vendor service saved — scan and reconnect to pick it up.",
    });
  }

  /** Swap between the iOS bridge, direct Web Bluetooth and the demo simulator. */
  setTransport(kind: TransportKind) {
    this.transport?.dispose();
    this.transport = null;
    if (this.graph) disposeGraph(this.graph);
    this.graph = null;
    this.kind = kind;
    this.set({
      hostKind: kind,
      devices: [],
      gattChars: [],
      audioCharId: null,
      deviceId: null,
      capturing: false,
      analyser: null,
      callStream: null,
      status: "idle",
      error: null,
    });
    this.onCapturingChange(false);
  }

  destroy() {
    this.onCapturingChange(false);
    this.transport?.dispose();
    this.transport = null;
    if (this.graph) disposeGraph(this.graph);
    this.graph = null;
    this.listeners.clear();
  }
}
