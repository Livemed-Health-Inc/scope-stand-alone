import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  StethoscopeClient,
  type StethoscopeClientOptions,
  type StethoscopeState,
  type StethoscopeSettings,
} from "../core/client";
import type { AudioChannel, PcmFormat, TransportKind } from "../core/transport/mintti";
import type { AuscultationMode } from "../core/transport/types";

/**
 * React binding for {@link StethoscopeClient}. Owns one client per component
 * and re-renders on every state change.
 */
export function useStethoscope(options: StethoscopeClientOptions = {}) {
  const optsRef = useRef(options);
  const [client] = useState(() => new StethoscopeClient(optsRef.current));

  useEffect(() => () => client.destroy(), [client]);

  const state = useSyncExternalStore(
    client.subscribe,
    client.getState,
    client.getState,
  ) as StethoscopeState;

  const set = useCallback(
    <K extends keyof StethoscopeSettings>(key: K) =>
      (value: StethoscopeSettings[K]) =>
        client.update({ [key]: value } as Partial<StethoscopeSettings>),
    [client],
  );

  const actions = useMemo(
    () => ({
      client,
      scan: () => void client.scan(),
      autoPair: () => void client.autoPair(),
      connect: (uuid: string) => void client.connect(uuid),
      disconnect: () => client.disconnect(),
      startCapture: () => void client.startCapture(),
      stopCapture: () => client.stopCapture(),
      startRecording: () => client.startRecording(),
      stopRecording: () => client.stopRecording(),
      selectAudioChar: (id: string) => client.selectAudioChar(id),
      setPcmFormat: (patch: Partial<PcmFormat>) => client.setPcmFormat(patch),
      wakeDevice: () => client.wakeDevice(),
      addVendorService: (uuid: string) => client.addVendorService(uuid),
      setTransport: (kind: TransportKind) => client.setTransport(kind),
      update: (patch: Partial<StethoscopeSettings>) => client.update(patch),
      setMode: set("mode") as (m: AuscultationMode) => void,
      setChannel: set("channel") as (c: AudioChannel) => void,
      setGain: set("gain") as (v: number) => void,
      setBass: set("bass") as (v: number) => void,
      setDenoise: set("denoise") as (v: boolean) => void,
      setBeatBoost: set("beatBoost") as (v: number) => void,
      setMonitoring: set("monitoring") as (v: boolean) => void,
    }),
    [client, set],
  );

  return { ...state, ...actions };
}
