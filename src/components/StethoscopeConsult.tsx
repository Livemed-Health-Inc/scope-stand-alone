import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Circle,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Stethoscope,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";

export type AuscultationSite = {
  id: string;
  label: string;
  group: "Cardiac" | "Pulmonary";
  x: number;
  y: number;
  bpmBase: number;
};

const SITES: AuscultationSite[] = [
  { id: "aortic", label: "Aortic", group: "Cardiac", x: 41, y: 30, bpmBase: 78 },
  { id: "pulmonic", label: "Pulmonic", group: "Cardiac", x: 59, y: 30, bpmBase: 78 },
  { id: "tricuspid", label: "Tricuspid", group: "Cardiac", x: 47, y: 43, bpmBase: 76 },
  { id: "mitral", label: "Mitral / Apex", group: "Cardiac", x: 60, y: 50, bpmBase: 80 },
  { id: "ruq", label: "R Upper Lobe", group: "Pulmonary", x: 30, y: 26, bpmBase: 18 },
  { id: "luq", label: "L Upper Lobe", group: "Pulmonary", x: 70, y: 26, bpmBase: 18 },
  { id: "rll", label: "R Lower Lobe", group: "Pulmonary", x: 30, y: 58, bpmBase: 18 },
  { id: "lll", label: "L Lower Lobe", group: "Pulmonary", x: 70, y: 58, bpmBase: 18 },
];

type Props = {
  peerName: string;
  peerRole: string;
  patientRoom?: string | null;
  reason?: string | null;
  onEnd: () => void;
};

export function StethoscopeConsult({ peerName, peerRole, patientRoom, reason, onEnd }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [site, setSite] = useState<AuscultationSite>(SITES[3]!);
  const [mode, setMode] = useState<"bell" | "diaphragm">("diaphragm");
  const [gain, setGain] = useState<number[]>([65]);
  const [recording, setRecording] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [camError, setCamError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setCamError("Camera unavailable — audio-only consult"));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    setCamOn(next);
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  }, [camOn]);

  // Live auscultation waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;

    const cardiac = site.group === "Cardiac";
    const amp = 0.28 + (gain[0] ?? 60) / 260;
    const sharpen = mode === "diaphragm" ? 1 : 0.55;

    const draw = () => {
      const w = (canvas.width = canvas.clientWidth * 2);
      const h = (canvas.height = canvas.clientHeight * 2);
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 2;
      for (let gx = 0; gx < w; gx += w / 24) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.lineWidth = 4;
      ctx.strokeStyle = cardiac ? "oklch(0.78 0.13 195)" : "oklch(0.72 0.16 154)";
      ctx.shadowBlur = 18;
      ctx.shadowColor = ctx.strokeStyle as string;

      for (let x = 0; x < w; x++) {
        const p = x / w;
        const phase = (p * (cardiac ? 3 : 1.2) + t) % 1;
        let v: number;
        if (cardiac) {
          const s1 = Math.exp(-Math.pow((phase - 0.12) / (0.028 / sharpen), 2));
          const s2 = Math.exp(-Math.pow((phase - 0.42) / (0.022 / sharpen), 2)) * 0.72;
          const noise = (Math.sin(x * 0.6 + t * 40) + Math.sin(x * 1.7)) * 0.02;
          v = (s1 - s2 * 0.9) * amp * 2 + noise;
        } else {
          const breath = Math.sin(phase * Math.PI * 2);
          const turbulence = Math.sin(x * 2.1 + t * 30) * Math.sin(x * 0.7 + t * 11);
          v = breath * turbulence * amp * 1.1;
        }
        const y = h / 2 - v * h * 0.42;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      t += 0.004;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [site, mode, gain]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      {/* A/V column */}
      <section className="panel-surface overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="label-caps">Live consult</p>
            <h2 className="text-lg font-semibold">{peerName}</h2>
            <p className="text-xs text-muted-foreground">{peerRole}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="gap-1 bg-destructive/15 text-destructive">
              <Circle className="size-2 fill-current" /> LIVE
            </Badge>
            <span className="font-mono text-sm text-muted-foreground">
              {mm}:{ss}
            </span>
          </div>
        </header>

        <div className="relative aspect-video bg-black/60">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/15 text-2xl font-semibold text-primary ring-pulse">
                {peerName
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Remote video connected</p>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
            <div className="sweep-line h-px w-1/3 bg-primary/70" />
          </div>
          <div className="absolute bottom-3 right-3 w-40 overflow-hidden rounded-lg border border-border bg-black/70">
            <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" />
            {!camOn && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-xs text-muted-foreground">
                Camera off
              </div>
            )}
          </div>
          {camError && (
            <p className="absolute left-3 top-3 rounded-md bg-warning/15 px-2 py-1 text-xs text-warning">{camError}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-xs text-muted-foreground">
            {patientRoom && <span className="mr-3">Room {patientRoom}</span>}
            {reason && <span>{reason}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" onClick={toggleMic} aria-label="Toggle microphone">
              {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            </Button>
            <Button variant="secondary" size="icon" onClick={toggleCam} aria-label="Toggle camera">
              {camOn ? <Video className="size-4" /> : <VideoOff className="size-4" />}
            </Button>
            <Button variant="destructive" onClick={onEnd} className="gap-2">
              <PhoneOff className="size-4" /> End consult
            </Button>
          </div>
        </div>
      </section>

      {/* Stethoscope column */}
      <section className="panel-surface p-4">
        <header className="mb-4 flex items-center gap-2">
          <Stethoscope className="size-5 text-primary" />
          <div>
            <p className="label-caps">Virtualis stethoscope</p>
            <h2 className="text-base font-semibold">Auscultation</h2>
          </div>
          <Badge className="ml-auto bg-primary/15 text-primary">{site.label}</Badge>
        </header>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,150px)_1fr]">
          <div className="relative aspect-[3/4] rounded-xl border border-border bg-panel/60">
            <svg viewBox="0 0 100 130" className="absolute inset-0 size-full opacity-40">
              <path
                d="M50 8c7 0 12 5 12 11 0 4-1 6-3 8 10 3 19 8 22 14 2 5 3 16 3 24 0 5-4 7-8 6l-3 40c0 4-3 6-7 6H31c-4 0-7-2-7-6l-3-40c-4 1-8-1-8-6 0-8 1-19 3-24 3-6 12-11 22-14-2-2-3-4-3-8 0-6 5-11 12-11z"
                fill="currentColor"
                className="text-muted-foreground"
              />
            </svg>
            {SITES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSite(s)}
                aria-label={s.label}
                className={`absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all ${
                  site.id === s.id
                    ? "scale-125 border-primary bg-primary ring-pulse"
                    : s.group === "Cardiac"
                      ? "border-primary/50 bg-primary/20 hover:bg-primary/40"
                      : "border-success/50 bg-success/20 hover:bg-success/40"
                }`}
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
              />
            ))}
          </div>

          <div className="space-y-3">
            <div className="h-28 overflow-hidden rounded-xl border border-border bg-black/40">
              <canvas ref={canvasRef} className="size-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-panel/60 px-3 py-2">
                <p className="label-caps">{site.group === "Cardiac" ? "Heart rate" : "Resp. rate"}</p>
                <p className="font-mono text-xl font-semibold text-primary">
                  {site.bpmBase}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {site.group === "Cardiac" ? "bpm" : "rpm"}
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-border bg-panel/60 px-3 py-2">
                <p className="label-caps">Signal</p>
                <p className="flex items-center gap-1 font-mono text-xl font-semibold text-success">
                  <Activity className="size-4" /> Clear
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="label-caps mb-2">Chestpiece mode</p>
            <div className="grid grid-cols-2 gap-2">
              {(["diaphragm", "bell"] as const).map((m) => (
                <Button
                  key={m}
                  variant={mode === m ? "default" : "secondary"}
                  onClick={() => setMode(m)}
                  className="capitalize"
                >
                  {m}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === "diaphragm" ? "High frequency — breath sounds, S1/S2" : "Low frequency — murmurs, gallops"}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label-caps flex items-center gap-1">
                <Volume2 className="size-3.5" /> Amplification
              </p>
              <span className="font-mono text-xs text-muted-foreground">{gain[0]}%</span>
            </div>
            <Slider value={gain} onValueChange={setGain} max={100} step={1} />
          </div>

          <Button
            variant={recording ? "destructive" : "secondary"}
            className="w-full gap-2"
            onClick={() => setRecording((r) => !r)}
          >
            <Radio className="size-4" />
            {recording ? "Stop recording" : `Record ${site.label} sample`}
          </Button>
        </div>
      </section>
    </div>
  );
}
