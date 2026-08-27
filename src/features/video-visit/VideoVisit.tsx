import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, Mic, MicOff, Radio, Stethoscope, Video, VideoOff, X } from "lucide-react";
import { useCameraDevices } from "@/lib/media/useCameraDevices";
import { logCallEvent, type CallEvent } from "@/lib/analytics";


import { StethoscopePanel } from "@/features/stethoscope";
import { Waveform } from "@/features/stethoscope";
import { useStreamAnalyser } from "@/features/stethoscope";
import { useAuscultationLink, type LinkRole } from "@/lib/webrtc/useAuscultationLink";
import { useOutgoingRing } from "@/lib/webrtc/callRing";

export type { LinkRole };

export interface VitalReading {
  label: string;
  value: string;
  unit: string;
  warn?: boolean;
}

export interface VideoVisitProps {
  /** Signalling room key — both devices must pass the same value. */
  roomId: string;
  /** Patient display name shown on the video tile. */
  patient: string;
  /** Bed / room label shown next to the patient name. */
  room?: string;
  /** Originating hospital shown in the visit header. */
  hospital?: string;
  /** Originating unit / floor shown in the visit header. */
  unit?: string;
  /** Header title (e.g. the encounter or clinician name). */
  title?: string;
  /** Which side this device is: "patient" (bedside/nurse) or "remote" (doctor). */
  role: LinkRole;
  /** Name announced in the incoming-call ring on the remote side. */
  callerName?: string;
  /** Vitals strip. Pass [] to hide. */
  vitals?: VitalReading[];
  /** Optional filler clip shown until the peer's camera arrives. */
  placeholderVideoUrl?: string;
  /** Show the ALIS ambient-scribe banner. */
  showScribeBanner?: boolean;
  /** Let the user flip sides from inside the auscultation drawer (testing aid). */
  allowRoleSwitch?: boolean;
  /** Let the remote (doctor) device pair its own scope and monitor locally. */
  allowRemoteLocalScope?: boolean;
  /** Consult id used to attribute analytics events. Defaults to roomId. */
  callId?: string;
  /** Called when the user taps the back arrow or "End visit". */
  onEnd?: () => void;
}


/**
 * Self-contained telehealth video visit: two-way WebRTC video + audio, PiP
 * self-view, vitals strip and a Bluetooth stethoscope auscultation drawer.
 *
 * Framework-agnostic — no router or loader dependency. Drop it into any React
 * app and supply the props.
 */
export function VideoVisit({
  roomId,
  patient,
  room,
  hospital,
  unit,
  title,
  role: roleProp,
  callerName,
  vitals = [],
  placeholderVideoUrl,
  showScribeBanner = false,
  allowRoleSwitch = false,
  allowRemoteLocalScope = false,
  callId,
  onEnd,
}: VideoVisitProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connecting, setConnecting] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [scribe, setScribe] = useState(true);
  const [scope, setScope] = useState(false);
  const [role, setRole] = useState<LinkRole>(roleProp);
  useEffect(() => {
    setRole(roleProp);
  }, [roleProp]);
  // A consult in progress counts as an active session: the privacy auto-lock
  // must never tear down a live call while a clinician is watching/listening.
  useEffect(() => holdSessionActive(), []);
  const isBedside = role === "patient";

  // ---- Consult analytics ---------------------------------------------
  const analyticsCallId = callId ?? roomId;
  const track = useCallback(
    (event: Omit<CallEvent, "callId">) => {
      void logCallEvent({ ...event, callId: analyticsCallId });
    },
    [analyticsCallId],
  );
  useEffect(() => {
    const joinedAt = Date.now();
    void logCallEvent({
      kind: "visit_join",
      callId: analyticsCallId,
      details: { role: roleProp, hospital, unit },
    });
    return () => {
      void logCallEvent({
        kind: "visit_leave",
        callId: analyticsCallId,
        durationMs: Date.now() - joinedAt,
        details: { role: roleProp },
      });
    };
  }, [analyticsCallId, roleProp, hospital, unit]);



  const [scopeStream, setScopeStream] = useState<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [listening, setListening] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const [selfStream, setSelfStream] = useState<MediaStream | null>(null);
  const [selfError, setSelfError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [camPicker, setCamPicker] = useState(false);
  const { cameras, cameraId, preferenceReady, setCameraId, refresh: refreshCameras } = useCameraDevices(!!selfStream);

  // Local camera + microphone, acquired once for the whole visit.
  // Re-acquired when the clinician switches to an external camera.
  useEffect(() => {
    if (!preferenceReady) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let microphoneStream: MediaStream | null = null;
    const md = navigator.mediaDevices;

    const attach = (s: MediaStream) => {
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      setSelfStream(s);
      setSelfError(null);
    };

    if (!md?.getUserMedia) {
      setSelfError(
        window.isSecureContext === false
          ? "Camera needs a secure (https) connection"
          : "This browser blocks camera access",
      );
      return;
    }

    // Acquire video independently from the microphone. Chrome rejects the
    // entire combined request when an enterprise policy, another tab, or the
    // operating system blocks only the microphone, which previously made a
    // healthy bedside camera appear unavailable to the physician.
    const videoAttempts: MediaTrackConstraints[] = [
      ...(cameraId ? [{ deviceId: { exact: cameraId } } as MediaTrackConstraints] : []),
      {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      {},
    ];

    void (async () => {
      let cameraStream: MediaStream | null = null;
      let lastErr: unknown = null;
      for (const video of videoAttempts) {
        if (cancelled) return;
        try {
          cameraStream = await md.getUserMedia({ video, audio: false });
          break;
        } catch (e) {
          lastErr = e;
        }
      }

      // Chrome/Edge report NotFoundError before the user has granted access,
      // and again for a moment while a USB camera is still enumerating.
      // Re-enumerate and try once more before declaring "no camera".
      if (!cameraStream && !cancelled && md.enumerateDevices) {
        try {
          const devices = await md.enumerateDevices();
          if (devices.some((d) => d.kind === "videoinput")) {
            await new Promise((r) => setTimeout(r, 400));
            if (!cancelled) cameraStream = await md.getUserMedia({ video: true, audio: false });
          }
        } catch (e) {
          lastErr = e;
        }
      }


      if (cancelled) {
        cameraStream?.getTracks().forEach((track) => track.stop());
        return;
      }

      if (cameraStream) {
        // Publish and render the camera immediately; microphone acquisition
        // must never hold up the patient video.
        attach(cameraStream);
        const videoTrack = cameraStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.contentHint = "motion";
          videoTrack.onended = () => {
            if (!cancelled) setSelfError("Camera disconnected — reconnect it, then retry");
          };
        }

        try {
          microphoneStream = await md.getUserMedia({
            video: false,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          if (cancelled) {
            microphoneStream.getTracks().forEach((track) => track.stop());
            return;
          }
          const microphone = microphoneStream.getAudioTracks()[0];
          if (microphone) {
            cameraStream.addTrack(microphone);
            // MediaStream is mutable, so create a new instance to notify React
            // and the WebRTC publisher that an audio track was added.
            stream = cameraStream;
            setSelfStream(new MediaStream(cameraStream.getTracks()));
          }
        } catch {
          // Keep the video call usable when Chrome cannot open the microphone.
        }
        return;
      }

      const name = (lastErr as DOMException | null)?.name;
      const embedded = typeof window !== "undefined" && window.self !== window.top;
      setSelfError(
        name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError"
          ? "Camera blocked — select the camera icon in the address bar, allow access, then retry"
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? embedded
              ? "No camera available in this embedded view — open the app in its own browser tab"
              : "No camera detected — plug in or enable a webcam (check Windows camera privacy settings), then retry"

            : name === "NotReadableError" || name === "TrackStartError" || name === "AbortError"
              ? "Chrome could not start the camera — close other camera apps or tabs, then retry"
              : name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError"
                ? "The selected camera is unavailable — choose another camera and retry"
              : "Could not start the camera",
      );
      // A saved external camera that no longer exists shouldn't stick around.
      if (cameraId && (name === "NotFoundError" || name === "OverconstrainedError")) setCameraId(null);
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      microphoneStream?.getTracks().forEach((t) => t.stop());
      setSelfStream(null);
    };
  }, [cameraId, preferenceReady, retryKey, setCameraId]);

  const retryCamera = useCallback(() => {
    setSelfError(null);
    void refreshCameras().finally(() => setRetryKey((key) => key + 1));
  }, [refreshCameras]);



  // Camera / mic toggles just enable or disable the published tracks.
  // While the nurse is auscultating, only the stethoscope feed goes out:
  // the room microphone is muted so no other noise reaches the doctor.
  const auscultating = role === "patient" && !!scopeStream?.getAudioTracks().length;
  useEffect(() => {
    selfStream?.getVideoTracks().forEach((t) => (t.enabled = camOn));
  }, [selfStream, camOn]);
  useEffect(() => {
    selfStream?.getAudioTracks().forEach((t) => (t.enabled = micOn && !auscultating));
  }, [selfStream, micOn, auscultating]);

  useEffect(() => {
    const el = selfVideoRef.current;
    if (!el) return;
    el.srcObject = selfStream;
    if (selfStream) void el.play().catch(() => {});
  }, [selfStream]);

  const handleCallStream = useCallback((s: MediaStream | null) => setScopeStream(s), []);

  // Everything this device publishes: camera, mic and (nurse) heart sounds.
  const [publishStream, setPublishStream] = useState<MediaStream | null>(null);
  // A media element only ever plays the FIRST audio track of a MediaStream, so
  // the mic and the stethoscope are mixed into one track before sending.
  const [mixedAudio, setMixedAudio] = useState<MediaStreamTrack | null>(null);
  useEffect(() => {
    const sources = [
      selfStream && selfStream.getAudioTracks().length ? selfStream : null,
      role === "patient" && scopeStream?.getAudioTracks().length ? scopeStream : null,
    ].filter(Boolean) as MediaStream[];
    if (!sources.length) {
      setMixedAudio(null);
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx: AudioContext = new Ctor();
    const dest = ctx.createMediaStreamDestination();
    const nodes = sources.map((s) => {
      const n = ctx.createMediaStreamSource(s);
      n.connect(dest);
      return n;
    });
    const track = dest.stream.getAudioTracks()[0] ?? null;
    // Tell the encoder to preserve low frequencies instead of speech-optimising.
    if (track) track.contentHint = "music";
    setMixedAudio(track);
    void ctx.resume().catch(() => {});
    return () => {
      nodes.forEach((n) => n.disconnect());
      dest.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [selfStream, scopeStream, role]);

  useEffect(() => {
    const tracks = [
      ...(selfStream?.getVideoTracks() ?? []),
      ...(mixedAudio ? [mixedAudio] : []),
    ];
    setPublishStream(tracks.length ? new MediaStream(tracks) : null);
  }, [selfStream, mixedAudio]);

  const link = useAuscultationLink({
    roomId,
    role,
    enabled: true,
    localStream: publishStream,
  });

  const remoteHasVideo = !!link.remoteStream?.getVideoTracks().length;

  // Waveform of what this device hears: the live stethoscope feed on the nurse
  // side, the incoming call audio on the doctor side (falling back to a locally
  // paired scope so the trace still shows during single-device testing).
  const waveStream = role === "patient" ? scopeStream : (link.remoteStream ?? scopeStream);
  const waveAnalyser = useStreamAnalyser(waveStream);

  // Patient side rings the remote side until they join the room.
  useOutgoingRing(
    {
      consultId: roomId,
      patient,
      room: room ?? "",
      caller: callerName ?? patient,
    },
    role === "patient" && !link.peerPresent,
  );

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.srcObject = link.remoteStream;
    el.muted = !listening;
    if (link.remoteStream)
      el.play().then(
        () => setAudioBlocked(false),
        () => setAudioBlocked(true),
      );
  }, [link.remoteStream, listening]);

  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el) return;
    // Remote audio rides the main video element; this element is only used
    // when the peer publishes audio without video.
    el.srcObject = remoteHasVideo ? null : link.remoteStream;
    el.muted = !listening;
    if (!remoteHasVideo && link.remoteStream && listening)
      el.play().then(
        () => setAudioBlocked(false),
        () => setAudioBlocked(true),
      );
  }, [link.remoteStream, listening, remoteHasVideo]);

  // Browsers block audible autoplay until the user interacts with the page.
  const enableAudio = () => {
    setListening(true);
    [remoteVideoRef.current, remoteAudioRef.current].forEach((el) => {
      if (!el) return;
      el.muted = false;
      void el.play().catch(() => {});
    });
    setAudioBlocked(false);
  };

  useEffect(() => {
    const t = window.setTimeout(() => setConnecting(false), 2200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!connecting) void videoRef.current?.play().catch(() => {});
  }, [connecting]);

  return (
    <main className={`flex min-h-screen w-full flex-col bg-navy-900 pb-4 pt-3 text-slate-100 ${isBedside ? "" : "px-3 sm:px-5 lg:px-6"}`}>
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3">
        {onEnd && (
          <button onClick={onEnd} aria-label="Leave visit" className="shrink-0 text-slate-400">
            <ChevronLeft className="size-6" />
          </button>
        )}
        <div className="col-start-2 min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">
            {connecting ? "• Connecting" : "• Live"}
            {title ? ` · ${title}` : ""}
          </p>
          <p className="truncate text-xs text-slate-400">
            {hospital ?? "Virtualis General Hospital"}
            {unit ? ` · ${unit}` : ""}
            {room ? ` · ${room}` : ""}
          </p>
        </div>
      </header>

      <div className={`mt-3 flex flex-1 flex-col gap-2 ${isBedside ? "" : "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] lg:items-start lg:gap-5"}`}>
        {/* Left column on wide screens, inline flow on mobile */}
        <div className={isBedside ? "flex flex-1 flex-col gap-2 min-h-0" : "contents lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:gap-2"}>

      <section className={`relative overflow-hidden rounded-3xl bg-navy-800 ${isBedside ? "flex-1 min-h-0" : ""}`}>
        <video
          ref={remoteVideoRef}
          className={`w-full object-cover ${isBedside ? "absolute inset-0 h-full" : "aspect-4/3 lg:aspect-video"} ${remoteHasVideo ? "" : "hidden"}`}
          playsInline
          autoPlay
        />
        {!remoteHasVideo && placeholderVideoUrl && (
          <video
            ref={videoRef}
            src={placeholderVideoUrl}
            className={`w-full object-cover transition-opacity ${isBedside ? "absolute inset-0 h-full" : "aspect-4/3 lg:aspect-video"} ${
              connecting ? "opacity-0" : "opacity-100"
            }`}
            playsInline
            loop
            muted
            autoPlay
          />
        )}
        {!remoteHasVideo && !placeholderVideoUrl && (
          <div className={`w-full ${isBedside ? "absolute inset-0 h-full" : "aspect-4/3 lg:aspect-video"}`} />
        )}
        {connecting && !remoteHasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <span className="flex size-16 items-center justify-center rounded-full bg-primary/30 ring-8 ring-primary/10 sm:size-24">
              <Video className="size-7 text-slate-100 sm:size-9" />
            </span>
            <div className="px-4 text-center">
              <p className="text-base font-semibold sm:text-lg">Waiting room</p>
              <p className="text-xs text-slate-400 sm:text-sm">
                Admitting {patient} · consent on file
              </p>
            </div>
          </div>
        )}
        <span className="absolute left-3 top-3 max-w-[55%] truncate rounded-full bg-navy-900/70 px-3 py-1 text-xs font-medium">
          {patient}
          {room ? ` · ${room}` : ""}
        </span>
        {audioBlocked && link.remoteStream && (
          <button
            onClick={enableAudio}
            className="absolute inset-x-0 top-1/2 mx-auto w-max -translate-y-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg"
          >
            Tap to enable sound
          </button>
        )}
        <span className="absolute bottom-3 left-3 max-w-[70%] truncate rounded-full bg-navy-900/70 px-3 py-1 text-[10px] font-medium text-slate-300">
          {link.state === "live"
            ? remoteHasVideo
              ? `Live · ${role === "patient" ? "doctor" : "bedside"} camera`
              : "Live · audio only"
            : link.peerPresent
              ? "Connecting to the other side…"
              : "Waiting for the other side to join…"}
        </span>

        {selfError && (
          <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive-foreground">
            <span className="flex-1">{selfError}</span>
            <button
              type="button"
              onClick={retryCamera}
              className="rounded-full bg-destructive px-3 py-1 text-[11px] font-semibold text-destructive-foreground"
            >
              Retry camera
            </button>
          </div>
        )}

        <div className="absolute right-3 top-3 w-20 overflow-hidden rounded-xl border border-navy-700/80 bg-navy-700 shadow-lg sm:w-24 lg:w-32">
          <div className="relative aspect-3/4 w-full">
            <video
              ref={selfVideoRef}
              className={`size-full object-cover -scale-x-100 ${camOn && selfStream ? "" : "opacity-0"}`}
              playsInline
              muted
              autoPlay
            />
            {!(camOn && selfStream) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center">
                <VideoOff className="size-4 text-slate-400" />
                <span className="text-[9px] leading-tight text-slate-400">
                  {selfError ? "No camera" : "Camera off"}
                </span>
              </div>
            )}
          </div>

          <p className="bg-navy-900/70 py-0.5 text-center text-[9px] font-medium text-slate-300">
            You
          </p>
        </div>
      </section>

      {vitals.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {vitals.map((v) => (
            <div
              key={v.label}
              className={`min-w-[78px] shrink-0 rounded-xl border px-2.5 py-1.5 ${
                v.warn ? "border-amber-500/40 bg-amber-500/5" : "border-navy-700 bg-navy-800"
              }`}
            >
              <p className="text-[10px] uppercase tracking-widest text-slate-400">{v.label}</p>
              <p className="text-base font-bold">
                {v.value} <span className="text-xs font-medium text-slate-400">{v.unit}</span>
              </p>
            </div>
          ))}
        </div>
      )}
        </div>

        {/* Right column on wide screens */}
        <div className={isBedside ? "flex flex-col gap-2" : "contents lg:col-start-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-2"}>
      {showScribeBanner && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            A
          </span>
          <p className="min-w-0 flex-1 text-xs">
            ALIS ambient scribe is {scribe ? "capturing" : "paused for"} this encounter.
          </p>
          <button
            onClick={() => setScribe((v) => !v)}
            className="shrink-0 rounded-full bg-navy-700 px-3 py-1 text-xs font-medium"
          >
            {scribe ? "Pause" : "Resume"}
          </button>
        </div>
      )}

      <button
        onClick={() => setScope((v) => !v)}
        aria-expanded={scope}
        className={`mt-2 flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition-all ${
          scope
            ? "border-primary bg-primary/15 shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]"
            : "border-primary bg-primary/10 shadow-lg shadow-primary/20 animate-pulse hover:bg-primary/20"
        }`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Stethoscope className="size-5" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-bold">Live auscultation</span>
          <span className="block text-xs text-slate-400">
            Tap to {scope ? "hide" : "open"} the Bluetooth stethoscope
          </span>
        </span>
        <span className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
          {scope ? "Hide" : "Open"}
        </span>
      </button>

      <section
        className={`mt-2 rounded-3xl bg-background p-3 text-foreground ${scope ? "" : "hidden"}`}
        aria-hidden={!scope}
      >
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold">Stethoscope</p>
          <button onClick={() => setScope(false)} aria-label="Close auscultation">
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        {allowRoleSwitch && (
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {(
              [
                { id: "patient" as LinkRole, label: "Patient side (nurse)" },
                { id: "remote" as LinkRole, label: "Remote (doctor)" },
              ]
            ).map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                aria-pressed={role === r.id}
                className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                  role === r.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        <div className="mb-2 flex items-center gap-2 rounded-xl border border-border px-3 py-2">
          <Radio
            className={`size-4 ${link.state === "live" ? "text-success" : "text-muted-foreground"}`}
          />
          <p className="flex-1 text-xs">
            {role === "patient"
              ? link.state === "live"
                ? "Streaming heart sounds to the doctor · room mic muted"
                : link.peerPresent
                  ? "Doctor joined — starting stream…"
                  : "Waiting for the doctor to join…"
              : link.state === "live"
                ? "Receiving live heart sounds from the patient"
                : link.peerPresent
                  ? "Patient side joined — connecting…"
                  : "Waiting for the patient-side device…"}
          </p>
          {role === "remote" && (
            <button
              onClick={() => setListening((v) => !v)}
              className="rounded-full bg-muted px-3 py-1 text-xs font-semibold"
            >
              {listening ? "Mute" : "Listen"}
            </button>
          )}
        </div>

        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        <div className="mb-2 rounded-xl border border-border bg-card p-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold">
              {role === "patient"
                ? "Outgoing auscultation waveform"
                : "Incoming auscultation waveform"}
            </span>
            <span className="text-muted-foreground">{waveStream ? "Live" : "No signal"}</span>
          </div>
          <div className="h-24">
            <Waveform analyser={waveAnalyser} active={!!waveStream} />
          </div>
        </div>

        {role === "patient" ? (
          <StethoscopePanel onCallStream={handleCallStream} localMonitor={false} onEvent={track} />
        ) : allowRemoteLocalScope ? (
          <>
            <p className="mb-2 rounded-xl bg-muted px-3 py-2 text-center text-[11px] text-muted-foreground">
              Testing build: you can pair a stethoscope on this device and listen through your own
              speakers. In the field it stays at the patient&apos;s bedside.
            </p>
            <StethoscopePanel onCallStream={handleCallStream} localMonitor onEvent={track} />
          </>
        ) : null}
      </section>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 lg:col-start-1 lg:row-start-2 lg:mt-0">
        <button
          onClick={() =>
            setMicOn((v) => {
              track({ kind: "mic_toggle", details: { on: !v } });
              return !v;
            })
          }
          aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-navy-700"
        >
          {micOn ? <Mic className="size-6" /> : <MicOff className="size-6 text-destructive" />}
        </button>
        <button
          onClick={() =>
            setCamOn((v) => {
              track({ kind: "camera_toggle", details: { on: !v } });
              return !v;
            })
          }
          aria-label={camOn ? "Turn camera off" : "Turn camera on"}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-navy-700"
        >
          {camOn ? <Video className="size-6" /> : <VideoOff className="size-6 text-destructive" />}
        </button>

        {cameras.length > 1 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setCamPicker((v) => !v)}
              aria-label="Choose camera"
              aria-expanded={camPicker}
              className="flex size-12 items-center justify-center rounded-full bg-navy-700"
            >
              <Camera className="size-6" />
            </button>
            {camPicker && (
              <div className="absolute bottom-14 left-1/2 z-20 w-64 -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-card p-1 text-foreground shadow-xl">
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Camera source
                </p>
                {[{ deviceId: "", label: "Default camera" }, ...cameras].map((c) => {
                  const active = (cameraId ?? "") === c.deviceId;
                  return (
                    <button
                      key={c.deviceId || "default"}
                      onClick={() => {
                        setCameraId(c.deviceId || null);
                        track({ kind: "camera_switch", details: { label: c.label } });
                        setCamPicker(false);
                      }}

                      className={`block w-full truncate rounded-xl px-3 py-2 text-left text-xs ${
                        active ? "bg-primary/15 font-semibold text-primary" : "hover:bg-muted"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onEnd}
          className="shrink-0 rounded-full bg-destructive px-5 py-3 text-sm font-semibold text-destructive-foreground sm:px-6"
        >
          End visit
        </button>
        </div>
      </div>
    </main>
  );
}

export default VideoVisit;