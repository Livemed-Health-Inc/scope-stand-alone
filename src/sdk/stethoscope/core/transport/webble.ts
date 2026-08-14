/// <reference types="web-bluetooth" />
/**
 * Experimental Web Bluetooth transport for the Mintti Smartho.
 *
 * The vendor SDK is iOS-only, so on Chrome desktop/Android we talk to the device's
 * GATT server directly. The audio characteristic UUID is not published in the SDK
 * headers, so the transport discovers every notifying characteristic, measures
 * throughput, and treats the fastest one (~16 kB/s for 8 kHz 16-bit PCM) as the
 * audio stream. The operator can override the pick from the UI.
 */

import {
  MINTTI_SAMPLE_RATE,
  DEFAULT_PCM_FORMAT,
  type GattCharInfo,
  type MinttiCommand,
  type MinttiEvent,
  type MinttiTransport,
  type PcmFormat,
} from "./mintti";
import { createImaState, decodeFrame } from "./ima-adpcm";

const uuid16 = (n: number) => `0000${n.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;

const KNOWN_128BIT: string[] = [
  "8ec90001-f315-4f60-9fb8-838830daea50", // Nordic buttonless DFU (from the SDK binary)
  "8ec90002-f315-4f60-9fb8-838830daea50",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART
  "0000fee7-0000-1000-8000-00805f9b34fb",
];

const EXTRA_KEY = "mintti.extraServices";

/**
 * UUIDs recovered from the vendor SDK binary: the Smartho exposes a proprietary
 * service 0x0001 whose characteristics 0x0003-0x0008 carry audio, heart rate,
 * version, mode and parameters, plus the standard battery service 0x180F.
 */
export const MINTTI_SERVICE = 0x0001;
export const MINTTI_AUDIO_CHAR = 0x0003;

/** Operator-supplied vendor service UUIDs (Web Bluetooth only exposes whitelisted ones). */
export function getExtraServices(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(EXTRA_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function setExtraServices(uuids: string[]) {
  if (typeof localStorage !== "undefined") localStorage.setItem(EXTRA_KEY, JSON.stringify(uuids));
}

/**
 * Services Web Bluetooth must be told about up-front — `getPrimaryServices()` only
 * returns whitelisted UUIDs, so an unlisted vendor service looks like "no services".
 * We whitelist every standard service plus the whole 0xFE00-0xFFFF vendor range.
 */
export function optionalServices(): BluetoothServiceUUID[] {
  const list: string[] = [...KNOWN_128BIT, ...getExtraServices()];
  // Vendor range used by the Smartho (service 0x0001) and other low-numbered
  // proprietary services — Chrome hides anything not whitelisted here.
  for (let n = 0x0001; n <= 0x00ff; n++) list.push(uuid16(n));
  for (let n = 0x1800; n <= 0x186f; n++) list.push(uuid16(n));
  for (let n = 0xfe00; n <= 0xffff; n++) list.push(uuid16(n));
  return [...new Set(list)];
}

const EXPECTED_BYTES_PER_SEC = MINTTI_SAMPLE_RATE * 2;

/**
 * Nordic DFU characteristics reboot the device into bootloader mode when written
 * to (that silently kills the audio session), so they are never poked or subscribed.
 */
const isDfu = (uuid: string) =>
  uuid.startsWith("8ec9") || uuid.startsWith("0000fe59") || uuid.includes("1530-1212-efde");

export function hasWebBluetooth(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

interface Tracked {
  info: GattCharInfo;
  char: BluetoothRemoteGATTCharacteristic;
  bytes: number;
}

export function createWebBluetoothTransport(): MinttiTransport {
  const listeners = new Set<(e: MinttiEvent) => void>();
  const emit = (e: MinttiEvent) => listeners.forEach((l) => l(e));

  let device: BluetoothDevice | null = null;
  let server: BluetoothRemoteGATTServer | null = null;
  const tracked = new Map<string, Tracked>();
  let audioId: string | null = null;
  let manualAudioId: string | null = null;
  let streaming = false;
  let rateTimer: number | null = null;
  let disconnectHooked = false;
  let userStopped = false;
  let reconnecting = false;
  let silentSeconds = 0;
  let format: PcmFormat = { ...DEFAULT_PCM_FORMAT };
  const chestIma = createImaState();
  const referenceIma = createImaState();

  const resetDecoders = () => {
    for (const state of [chestIma, referenceIma]) {
      state.predictor = 0;
      state.index = 0;
      state.sample = 0;
    }
  };

  const short = (uuid: string) => (uuid.startsWith("0000") ? uuid.slice(4, 8) : uuid.slice(0, 8));

  const report = () =>
    emit({ type: "gatt", chars: [...tracked.values()].map((t) => ({ ...t.info })), audioId });

  const onNotify = (id: string) => (ev: Event) => {
    const t = tracked.get(id);
    const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
    if (!t || !value) return;
    t.bytes += value.byteLength;
    t.info.packets += 1;
    t.info.lastBytes = value.byteLength;
    t.info.hex = [...new Uint8Array(value.buffer.slice(0, 16))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");

    if (!streaming || id !== audioId) return;

    if (format.codec === "ima") {
      // Vendor frame layout: the chest block is linear PCM on most frame sizes and
      // only the ambient/echo-reference block is ADPCM.
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const frame = decodeFrame(bytes, chestIma, referenceIma, !format.lowNibbleFirst);
      if (!frame) return;
      const requested = format.sensorChannel ?? "auto";
      const pcm = requested === "reference" && frame.reference ? frame.reference : frame.chest;
      emit({ type: "audio", channel: "result", pcm });
      return;
    }

    const start = Math.min(format.skipBytes, value.byteLength);
    const body = value.byteLength - start;
    if (body <= 0) return;
    let pcm: Int16Array;
    if (format.eightBit) {
      pcm = new Int16Array(body);
      for (let i = 0; i < body; i++) pcm[i] = (value.getUint8(start + i) - 128) * 256;
    } else {
      const n = body >> 1;
      pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) pcm[i] = value.getInt16(start + i * 2, !format.bigEndian);
    }
    emit({ type: "audio", channel: "result", pcm });
  };

  const pickAudio = () => {
    if (manualAudioId && tracked.has(manualAudioId)) {
      audioId = manualAudioId;
      return;
    }
    // Prefer the characteristic the vendor SDK uses for PCM audio.
    for (const t of tracked.values()) {
      if (t.info.service === "0001" && t.info.characteristic === "0003") {
        audioId = t.info.id;
        return;
      }
    }
    let best: Tracked | null = null;
    for (const t of tracked.values()) {
      if (!best || t.info.bytesPerSec > best.info.bytesPerSec) best = t;
    }
    // Anything under a fiftieth of the expected PCM rate is telemetry, not audio.
    audioId = best && best.info.bytesPerSec > EXPECTED_BYTES_PER_SEC / 50 ? best.info.id : null;
  };

  const startRateMeter = () => {
    if (rateTimer !== null) return;
    rateTimer = window.setInterval(() => {
      let total = 0;
      for (const t of tracked.values()) {
        t.info.bytesPerSec = t.bytes;
        total += t.bytes;
        t.bytes = 0;
      }
      pickAudio();
      report();
      // The device sometimes accepts the start opcode but goes quiet. Re-arm it
      // instead of leaving the session looking alive but silent.
      if (streaming && !userStopped) {
        silentSeconds = total === 0 ? silentSeconds + 1 : 0;
        if (silentSeconds >= 3) {
          silentSeconds = 0;
          void wake();
        }
      }
    }, 1000);
  };

  const readBattery = async () => {
    try {
      const svc = await server?.getPrimaryService(0x180f);
      const c = await svc?.getCharacteristic(0x2a19);
      const v = await c?.readValue();
      if (v) emit({ type: "battery", level: v.getUint8(0) });
    } catch {
      /* device may not expose a battery service */
    }
  };

  /** The characteristic the vendor SDK streams audio from (service 0001 / char 0003). */
  const audioTrack = () =>
    [...tracked.values()].find(
      (t) => t.info.service === "0001" && t.info.characteristic === "0003",
    ) ?? (audioId ? tracked.get(audioId) : undefined);

  /**
   * The vendor SDK has no start opcode: `startGetMinttiSmarthoAudioData` simply
   * enables notifications on the audio characteristic (and stop disables them).
   * Writing arbitrary opcodes to other characteristics is what used to reboot the
   * device, so streaming is toggled purely through the CCCD.
   */
  const setAudioNotify = async (enable: boolean) => {
    const t = audioTrack();
    if (!t || isDfu(t.char.uuid)) return;
    try {
      if (enable) {
        await t.char.startNotifications();
        t.info.notifying = true;
      } else {
        await t.char.stopNotifications();
        t.info.notifying = false;
      }
      report();
    } catch {
      /* the link may be mid-reconnect; the watchdog retries */
    }
  };

  const wake = async () => {
    await setAudioNotify(true);
  };

  const readVersion = async () => {
    try {
      const svc = await server?.getPrimaryService(0x180a);
      const c = await svc?.getCharacteristic(0x2a26);
      const v = await c?.readValue();
      if (v) emit({ type: "version", version: new TextDecoder().decode(v).trim() });
    } catch {
      /* optional */
    }
  };

  const discover = async () => {
    if (!server) return;
    const services = await server.getPrimaryServices();
    let notifyCount = 0;
    for (const svc of services) {
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try {
        chars = await svc.getCharacteristics();
      } catch {
        continue;
      }
      for (const char of chars) {
        const id = `${svc.uuid}/${char.uuid}`;
        if (isDfu(char.uuid)) continue;
        const info: GattCharInfo = {
          id,
          service: short(svc.uuid),
          characteristic: short(char.uuid),
          notifying: false,
          packets: 0,
          lastBytes: 0,
          bytesPerSec: 0,
          writable: char.properties.write || char.properties.writeWithoutResponse,
        };
        tracked.set(id, { info, char, bytes: 0 });
        if (char.properties.notify || char.properties.indicate) {
          try {
            char.addEventListener("characteristicvaluechanged", onNotify(id));
            await char.startNotifications();
            info.notifying = true;
            notifyCount += 1;
          } catch {
            info.notifying = false;
          }
        }
      }
    }
    startRateMeter();
    report();
    emit({
      type: "diag",
      message:
        services.length === 0
          ? "No GATT services are visible. The device's vendor service UUID is not whitelisted — add it under Vendor service UUID and reconnect."
          : `${services.length} services (${services.map((s) => short(s.uuid)).join(", ")}), ${tracked.size} characteristics, ${notifyCount} subscribed.`,
    });
  };

  const connect = async () => {
    if (!device?.gatt) throw new Error("No device selected.");
    server = await device.gatt.connect();
    if (!disconnectHooked) {
      disconnectHooked = true;
      device.addEventListener("gattserverdisconnected", () => {
        emit({ type: "connectState", connected: false });
        if (!userStopped) void reconnect();
      });
    }
    emit({ type: "connectState", connected: true });
    await discover();
    await readVersion();
    await readBattery();
    if (streaming) {
      emit({ type: "captureState", capturing: true });
      await wake();
    }
  };

  /**
   * BLE links to the stethoscope drop regularly (interference, power saving). Unless
   * the operator pressed stop, re-establish the link and resume the audio session.
   */
  const reconnect = async () => {
    if (reconnecting || !device?.gatt) return;
    reconnecting = true;
    for (let attempt = 1; attempt <= 5 && !userStopped; attempt++) {
      emit({ type: "diag", message: `Link dropped — reconnecting (attempt ${attempt} of 5)…` });
      await new Promise((r) => setTimeout(r, 800 * attempt));
      try {
        tracked.clear();
        await connect();
        emit({ type: "diag", message: "Reconnected — auscultation resumed." });
        reconnecting = false;
        return;
      } catch {
        /* device still out of range; retry */
      }
    }
    reconnecting = false;
    streaming = false;
    emit({ type: "captureState", capturing: false });
    emit({ type: "diag", message: "Could not reconnect. Power-cycle the stethoscope and scan again." });
  };

  const handle = async (command: MinttiCommand) => {
    switch (command.cmd) {
      case "startScan": {
        emit({ type: "bleState", available: hasWebBluetooth() });
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: optionalServices(),
        });
        emit({
          type: "scanResult",
          uuid: device.id,
          name: device.name ?? "Bluetooth stethoscope",
          rssi: 0,
        });
        break;
      }
      case "connect":
        await connect();
        break;
      case "autoPair": {
        // Devices already granted permission can be reconnected without a click.
        const bt = navigator.bluetooth as unknown as {
          getDevices?: () => Promise<BluetoothDevice[]>;
        };
        if (!bt?.getDevices) return;
        const known = await bt.getDevices();
        const match =
          known.find((d) => /smartho|mintti/i.test(d.name ?? "")) ?? known[0] ?? null;
        if (!match) return;
        device = match;
        emit({
          type: "scanResult",
          uuid: match.id,
          name: match.name ?? "Bluetooth stethoscope",
          rssi: 0,
        });
        break;
      }
      case "disconnect":
        streaming = false;
        userStopped = true;
        if (rateTimer !== null) window.clearInterval(rateTimer);
        rateTimer = null;
        tracked.clear();
        device?.gatt?.disconnect();
        emit({ type: "connectState", connected: false });
        break;
      case "startAudio":
        streaming = true;
        userStopped = false;
        silentSeconds = 0;
        resetDecoders();
        emit({ type: "captureState", capturing: true });
        await wake();
        break;
      case "stopAudio":
        streaming = false;
        userStopped = true;
        await setAudioNotify(false);
        emit({ type: "captureState", capturing: false });
        break;
      case "selectAudioChar":
        manualAudioId = command.id;
        pickAudio();
        report();
        break;
      case "setPcmFormat":
        format = { ...command.format };
        resetDecoders();
        break;
      case "wake":
        await wake();
        break;
      case "setEchoMode": {
        // The SDK writes a single mode byte to the vendor mode characteristic.
        for (const t of tracked.values()) {
          if (t.info.service !== "0001" || isDfu(t.char.uuid)) continue;
          // The Android SDK writes the echo mode byte to characteristic 0008.
          if (t.info.characteristic !== "0008") continue;
          if (!t.char.properties.write && !t.char.properties.writeWithoutResponse) continue;
          try {
            await t.char.writeValue(new Uint8Array([command.mode]));
          } catch {
            /* device rejected the mode change */
          }
          break;
        }
        break;
      }
      case "readBattery":
        await readBattery();
        break;
      case "readVersion":
        await readVersion();
        break;
      default:
        break;
    }
  };

  return {
    kind: "webble",
    send(command) {
      handle(command).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/cancelled|User cancelled/i.test(msg)) return;
        emit({ type: "transportError", message: msg });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (rateTimer !== null) window.clearInterval(rateTimer);
      rateTimer = null;
      try {
        device?.gatt?.disconnect();
      } catch {
        /* ignore */
      }
      tracked.clear();
      listeners.clear();
    },
  };
}
