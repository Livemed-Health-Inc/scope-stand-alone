import { useEffect, useRef, useState } from "react";
import {
  Bluetooth,
  Circle,
  Headphones,
  HeadphoneOff,
  Heart,
  Settings,
  Square,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Waveform } from "./Waveform";
import { useStethoscope } from "@/sdk/stethoscope/react";
import { MODE_FILTERS, type AuscultationMode } from "@/sdk/stethoscope";

const MODES: { id: AuscultationMode; label: string }[] = [
  { id: "bell", label: "Heart" },
  { id: "diaphragm", label: "Lung" },
  { id: "wide", label: "Wide" },
];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export type StethoscopeUsageEvent = {
  kind: "stethoscope_session" | "auscultation_site" | "recording";
  site?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
};

export function StethoscopePanel({
  className = "",
  onCallStream,
  localMonitor = true,
  brandIconUrl,
  onEvent,
}: {
  className?: string;
  /** Receives the processed heart-sound stream for remote streaming. */
  onCallStream?: (stream: MediaStream | null) => void;
  /** When false, heart sounds are never played out of this device's speakers. */
  localMonitor?: boolean;
  /** Optional logo shown in the panel header; falls back to a stethoscope icon. */
  brandIconUrl?: string;
  /** Usage telemetry: auscultation sessions, site changes and recordings. */
  onEvent?: (event: StethoscopeUsageEvent) => void;
}) {


  const s = useStethoscope();
  const { devices, deviceId, connect, connected, capturing, startCapture, autoPair } = s;
  const [showSettings, setShowSettings] = useState(false);
  const connectedRef = useRef(false);
  const [manualStop, setManualStop] = useState(false);
  // Pairing is permanent; connecting is a separate, explicit action.
  const [paired, setPaired] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("virtualis.stethoscope.paired") === "1";
  });
  const [manualDisconnect, setManualDisconnect] = useState(false);
  const manualDisconnectRef = useRef(false);
  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);
  // Only publish the feed while auscultation is actually running, so the call
  // can restore the room microphone as soon as listening stops.
  useEffect(() => {
    onCallStream?.(s.capturing ? s.callStream : null);
  }, [s.callStream, s.capturing, onCallStream]);
  // Patient-side devices publish heart sounds without monitoring them locally.
  useEffect(() => {
    if (!localMonitor) s.setMonitoring(false);
  }, [localMonitor, s.setMonitoring]);
  useEffect(() => {
    manualDisconnectRef.current = manualDisconnect;
  }, [manualDisconnect]);

  // ---- Usage telemetry -----------------------------------------------
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  const modeLabel = MODES.find((m) => m.id === s.mode)?.label ?? s.mode;
  const modeLabelRef = useRef(modeLabel);
  useEffect(() => {
    modeLabelRef.current = modeLabel;
  }, [modeLabel]);

  // One "stethoscope_session" per continuous auscultation run.
  const sessionStart = useRef<number | null>(null);
  useEffect(() => {
    if (capturing) {
      sessionStart.current = Date.now();
      return;
    }
    if (sessionStart.current !== null) {
      const durationMs = Date.now() - sessionStart.current;
      sessionStart.current = null;
      onEventRef.current?.({ kind: "stethoscope_session", site: modeLabelRef.current, durationMs });
    }
  }, [capturing]);
  useEffect(
    () => () => {
      if (sessionStart.current !== null) {
        onEventRef.current?.({
          kind: "stethoscope_session",
          site: modeLabelRef.current,
          durationMs: Date.now() - sessionStart.current,
        });
        sessionStart.current = null;
      }
    },
    [],
  );

  // Site / chestpiece mode selection while listening.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    onEventRef.current?.({ kind: "auscultation_site", site: modeLabel });
  }, [modeLabel]);

  // Saved clips.
  const wasRecording = useRef(false);
  useEffect(() => {
    if (wasRecording.current && !s.recording) {
      onEventRef.current?.({
        kind: "recording",
        site: modeLabelRef.current,
        durationMs: (s.lastClip?.seconds ?? 0) * 1000,
      });
    }
    wasRecording.current = s.recording;
  }, [s.recording, s.lastClip]);



  // Keep the stethoscope paired at all times: re-acquire the remembered device forever.
  useEffect(() => {
    void autoPair();
    const retry = window.setInterval(() => {
      if (!connectedRef.current) void autoPair();
    }, 4000);
    return () => window.clearInterval(retry);
  }, [autoPair]);

  useEffect(() => {
    if (devices.length > 0) {
      setPaired(true);
      window.localStorage.setItem("virtualis.stethoscope.paired", "1");
    }
  }, [devices]);

  // Only link up when the user hasn't explicitly disconnected.
  useEffect(() => {
    if (!deviceId && devices.length > 0 && !manualDisconnect) void connect(devices[0]!.uuid);
  }, [devices, deviceId, connect, manualDisconnect]);

  useEffect(() => {
    if (connected && !capturing && !manualStop) void startCapture();
  }, [connected, capturing, startCapture, manualStop]);

  useEffect(() => {
    if (!connected) setManualStop(false);
  }, [connected]);

  // Connect: link to the paired device (pair first if the browser has never seen one).
  const handleConnect = async () => {
    setManualDisconnect(false);
    if (connected) return;
    if (devices.length > 0) {
      void connect(devices[0]!.uuid);
      return;
    }
    await autoPair();
    window.setTimeout(() => {
      if (!connectedRef.current && !manualDisconnectRef.current) void s.scan();
    }, 1500);
  };

  const handleDisconnect = () => {
    setManualDisconnect(true);
    setManualStop(true);
    s.disconnect();
  };

  // Start auscultation: connect first if needed, then stream.
  const handleStart = async () => {
    setManualStop(false);
    if (connected) {
      void startCapture();
      return;
    }
    await handleConnect();
  };

  return (
    <div className={className}>

      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">LiveScope Auscultation</h2>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          <Settings className="size-4" />
        </Button>
      </div>

      {/* Device card */}
      <section className="mt-2 rounded-2xl border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Connected device</p>
            <p className="truncate text-sm font-semibold">Virtualis Consult</p>
            <p className="text-xs text-muted-foreground">
              {s.battery !== null ? `Battery ${s.battery}%` : "SN: —"}
            </p>
            {(() => {
              const connecting = s.status === "scanning" || s.status === "connecting";
              const label = connected
                ? capturing
                  ? "Connected · live"
                  : "Connected"
                : connecting
                  ? "Connecting…"
                  : paired
                    ? "Paired · not connected"
                    : "Not paired";
              const tone = connected
                ? "bg-success/10 text-success"
                : connecting
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground";
              const dot = connected
                ? "bg-success"
                : connecting
                  ? "bg-primary animate-pulse"
                  : "bg-muted-foreground/50";
              return (
                <span
                  className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}
                >
                  <span className={`size-2 rounded-full ${dot}`} />
                  {label}
                </span>
              );
            })()}
          </div>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted">
            {brandIconUrl ? (
              <img src={brandIconUrl} alt="" className="size-8 object-contain" />
            ) : (
              <Stethoscope className="size-6 text-muted-foreground" />
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {connected ? (
            <>
              {capturing ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setManualStop(true);
                    s.stopCapture();
                  }}
                >
                  <Square className="size-4" /> Stop
                </Button>
              ) : (
                <Button size="sm" className="w-full" onClick={() => void handleStart()}>
                  <Stethoscope className="size-4" /> Start
                </Button>
              )}
              <Button size="sm" variant="outline" className="w-full" onClick={handleDisconnect}>
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                className="w-full"
                onClick={() => void handleConnect()}
                disabled={s.status === "scanning" || s.status === "connecting"}
              >
                <Bluetooth className="size-4" /> Connect
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={s.scan}
                disabled={s.status === "scanning" || s.status === "connecting"}
              >
                <Bluetooth className="size-4" /> {paired ? "Re-pair" : "Pair"}
              </Button>
            </>
          )}
        </div>

        {!s.webBleSupported && (
          <p className="mt-2 text-xs text-destructive">
            This browser can&apos;t use Bluetooth. Open the app in Chrome or Edge on desktop or
            Android.
          </p>
        )}
        {s.error && <p className="mt-2 text-xs text-destructive">{s.error}</p>}
      </section>

      {/* Mode tabs */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => s.setMode(m.id)}
            className={`rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors ${
              s.mode === m.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Waveform */}
      <section className="mt-2 rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Live Waveform</h3>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`size-2.5 rounded-full ${s.recording ? "bg-destructive" : "bg-muted-foreground/40"}`}
            />
            <span className="tabular-nums text-muted-foreground">{fmt(s.elapsed)}</span>
          </div>
        </div>

        <div className="mt-2">
          <Waveform analyser={s.analyser} active={s.capturing} />
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2">
          <Heart
            key={s.beatTick}
            className="size-4 text-primary"
            style={{ animation: s.beatTick ? "beat-pulse 320ms ease-out" : undefined }}
          />
          <div className="text-xs">
            <span className="font-semibold tabular-nums">{s.liveBpm ?? "--"}</span>{" "}
            <span className="text-muted-foreground">BPM · live beat detection</span>
          </div>
        </div>
      </section>

      {/* Noise reduction + record */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <span className="truncate text-xs font-medium">Noise reduction</span>
          <Switch checked={s.denoise} onCheckedChange={s.setDenoise} />
        </div>
        {s.recording ? (
          <Button size="sm" variant="outline" className="shrink-0 text-destructive" onClick={s.stopRecording}>
            <Square className="size-4" /> Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={!s.capturing}
            onClick={s.startRecording}
          >
            <Circle className="size-4 fill-destructive text-destructive" /> Record
          </Button>
        )}
      </div>

      {s.lastClip && (
        <section className="mt-2 rounded-2xl border border-border bg-card p-3">
          <p className="text-sm font-semibold">Last recording · {s.lastClip.seconds}s</p>
          <audio className="mt-2 w-full" controls src={s.lastClip.url} />
          <a
            className="mt-2 inline-block text-xs text-primary underline"
            href={s.lastClip.url}
            download="auscultation.wav"
          >
            Download WAV
          </a>
        </section>
      )}

      {/* Monitor toggle */}
      {localMonitor && (
        <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-medium">
            {s.monitoring ? <Headphones className="size-4" /> : <HeadphoneOff className="size-4" />}
            Speaker monitoring
          </span>
          <Switch checked={s.monitoring} onCheckedChange={s.setMonitoring} />
        </div>
      )}

      {/* Advanced settings */}
      {showSettings && (
        <section className="mt-2 space-y-3 rounded-2xl border border-border bg-card p-3">
          <h3 className="text-sm font-semibold">Advanced</h3>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Amplification</span>
              <span className="tabular-nums text-muted-foreground">{s.gain.toFixed(1)}×</span>
            </div>
            <Slider
              value={[s.gain]}
              min={1}
              max={120}
              step={0.5}
              onValueChange={([v]) => s.setGain(v ?? 1)}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Heartbeat boost</span>
              <span className="tabular-nums text-muted-foreground">{s.beatBoost.toFixed(1)}×</span>
            </div>
            <Slider
              value={[s.beatBoost]}
              min={1}
              max={8}
              step={0.5}
              onValueChange={([v]) => s.setBeatBoost(v ?? 1)}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Low-frequency boost</span>
              <span className="tabular-nums text-muted-foreground">+{s.bass.toFixed(0)} dB</span>
            </div>
            <Slider
              value={[s.bass]}
              min={0}
              max={24}
              step={1}
              onValueChange={([v]) => s.setBass(v ?? 0)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">
              Sounds thin or crackly? Try the alternate decoding.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => s.setPcmFormat({ lowNibbleFirst: !s.pcmFormat.lowNibbleFirst })}
            >
              Decoding {s.pcmFormat.lowNibbleFirst ? "B" : "A"}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Chest sensor selection</span>
            <div className="flex gap-1">
              {(["auto", "chest", "reference"] as const).map((sensor) => (
                <Button
                  key={sensor}
                  size="sm"
                  variant={(s.pcmFormat.sensorChannel ?? "auto") === sensor ? "default" : "outline"}
                  onClick={() => s.setPcmFormat({ sensorChannel: sensor })}
                >
                  {sensor === "auto" ? "Auto" : sensor === "chest" ? "A" : "B"}
                </Button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {MODE_FILTERS[s.mode].hint} A is the chest sensor; B is the device&apos;s ambient
            reference mic.
          </p>
        </section>
      )}
    </div>
  );
}
