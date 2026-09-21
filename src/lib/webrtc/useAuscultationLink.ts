import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LinkRole = "patient" | "remote";
export type LinkState = "idle" | "waiting" | "connecting" | "live" | "error";
export type ScopePresence = { connected: boolean; capturing: boolean };

const ICE: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:global.stun.twilio.com:3478",
        "stun:stun.relay.metered.ca:80",
      ],
    },
    // Public relay so the call still connects across restrictive hospital /
    // cellular networks where a direct peer-to-peer path is impossible.
    {
      urls: [
        "turn:staticauth.openrelay.metered.ca:80",
        "turn:staticauth.openrelay.metered.ca:80?transport=tcp",
        "turn:staticauth.openrelay.metered.ca:443",
        "turns:staticauth.openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 4,
};


interface Signal {
  id: string;
  role: LinkRole;
  kind: "hello" | "hi" | "offer" | "answer" | "ice" | "bye" | "scope-status";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  scope?: ScopePresence;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/**
 * Heart sounds are not speech: Opus' default narrowband/DTX/variable-rate
 * behaviour chops the low thumps and injects sharp static on the listening
 * side. Force full-band, constant-rate, no-DTX audio in the SDP.
 */
const HIFI_OPUS = [
  "stereo=0",
  "sprop-stereo=0",
  "maxaveragebitrate=128000",
  "maxplaybackrate=48000",
  "sprop-maxcapturerate=48000",
  "useinbandfec=1",
  "usedtx=0",
  "cbr=1",
].join(";");

function hifiAudio(sdp: string): string {
  const pts = [...sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/48000/gim)].map((m) => m[1]);
  let out = sdp;
  for (const pt of pts) {
    const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, "im");
    if (fmtp.test(out)) {
      out = out.replace(fmtp, (_m, params: string) => {
        const kept = params
          .split(";")
          .filter((p) => !/^(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|sprop-maxcapturerate|useinbandfec|usedtx|cbr)=/i.test(p.trim()))
          .filter(Boolean);
        return `a=fmtp:${pt} ${[...kept, HIFI_OPUS].join(";")}`;
      });
    } else {
      out = out.replace(
        new RegExp(`^(a=rtpmap:${pt} opus/48000.*)$`, "im"),
        `$1\r\na=fmtp:${pt} ${HIFI_OPUS}`,
      );
    }
  }
  return out;
}

/** Give the audio encoder enough headroom for full-band auscultation. */
async function raiseAudioBitrate(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings.forEach((e) => {
      e.maxBitrate = 128000;
      (e as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = "high";
      e.priority = "high";
    });
    try {
      await sender.setParameters(params);
    } catch {
      /* browser may reject mid-negotiation; retried on the next pass */
    }
  }
}


/**
 * Two-way visit link: camera + microphone in both directions, plus the
 * processed stethoscope audio published from the patient-side device.
 * Signalling rides a Lovable Cloud realtime broadcast channel keyed on the
 * consult id. Peers identify themselves with a random id and use perfect
 * negotiation, so the link works no matter which side joins (or renegotiates)
 * first.
 */
export function useAuscultationLink(opts: {
  roomId: string;
  role: LinkRole;
  enabled: boolean;
  /** Everything this device publishes: camera, mic and (nurse) stethoscope audio. */
  localStream: MediaStream | null;
  /** Dedicated processed stethoscope feed. Never mixed with call speech. */
  localScopeStream?: MediaStream | null;
  localScope?: ScopePresence;
}) {
  const {
    roomId,
    role,
    enabled,
    localStream,
    localScopeStream = null,
    localScope = { connected: false, capturing: false },
  } = opts;
  const [state, setState] = useState<LinkState>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteScopeStream, setRemoteScopeStream] = useState<MediaStream | null>(null);
  const [remoteScope, setRemoteScope] = useState<ScopePresence>({ connected: false, capturing: false });
  const [peerPresent, setPeerPresent] = useState(false);

  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = newId();
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = localStream;
  const scopeStreamRef = useRef<MediaStream | null>(null);
  scopeStreamRef.current = localScopeStream;
  const syncRef = useRef<(() => void) | null>(null);
  const sendScopeRef = useRef<((scope: ScopePresence) => void) | null>(null);
  const subscribedRef = useRef(false);
  const localScopeRef = useRef(localScope);
  localScopeRef.current = localScope;

  const teardown = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setRemoteStream(null);
    setRemoteScopeStream(null);
    setRemoteScope({ connected: false, capturing: false });
  }, []);

  useEffect(() => {
    if (!enabled || !roomId) {
      teardown();
      setState("idle");
      return;
    }

    const me = idRef.current;
    let disposed = false;
    let makingOffer = false;
    let ignoreOffer = false;
    let peerId: string | null = null;
    /** Tie-break for glare: the peer with the larger id is polite. */
    const polite = () => (peerId ? me > peerId : false);
    const pending: RTCIceCandidateInit[] = [];
    setState("waiting");
    subscribedRef.current = false;

    const channel = supabase.channel(`ausc:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    const send = (payload: Omit<Signal, "id" | "role">) => {
      void channel.send({
        type: "broadcast",
        event: "signal",
        payload: { ...payload, id: me, role },
      });
    };
    sendScopeRef.current = (scope) => send({ kind: "scope-status", scope });

    const inbound = new MediaStream();
    const inboundScope = new MediaStream();
    let inboundTrackKey = "";
    let inboundScopeTrackKey = "";

    const publishInbound = (stream: MediaStream, scopeOnly: boolean) => {
      const tracks = stream.getTracks();
      const key = tracks.map((track) => track.id).sort().join(",");
      if (scopeOnly) {
        if (key === inboundScopeTrackKey) return;
        inboundScopeTrackKey = key;
        setRemoteScopeStream(tracks.length ? new MediaStream(tracks) : null);
        return;
      }
      if (key === inboundTrackKey) return;
      inboundTrackKey = key;
      setRemoteStream(tracks.length ? new MediaStream(tracks) : null);
    };

    // If the media path never comes up (blocked UDP, NAT with no direct route)
    // we re-gather candidates and re-offer instead of sitting on "connecting".
    let watchdog: number | undefined;
    let iceAttempts = 0;
    const clearWatchdog = () => {
      if (watchdog) window.clearTimeout(watchdog);
      watchdog = undefined;
    };
    const retryIce = () => {
      const pc = pcRef.current;
      if (!pc || disposed || iceAttempts >= 4) return;
      iceAttempts += 1;
      clearWatchdog();
      try {
        pc.restartIce();
      } catch {
        /* not negotiated yet */
      }
      void negotiate();
      armWatchdog();
    };
    function armWatchdog() {
      if (disposed || watchdog) return;
      watchdog = window.setTimeout(() => {
        watchdog = undefined;
        const pc = pcRef.current;
        if (!pc || pc.connectionState === "connected") return;
        retryIce();
      }, 9000);
    }



    const ensurePc = () => {
      if (pcRef.current) return pcRef.current;
      const pc = new RTCPeerConnection(ICE);
      const callAudio = pc.addTransceiver("audio", { direction: "sendrecv" });
      const callVideo = pc.addTransceiver("video", { direction: "sendrecv" });
      const scopeAudio = pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ kind: "ice", candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const scopeOnly = e.transceiver === scopeAudio;
        const target = scopeOnly ? inboundScope : inbound;
        target.addTrack(e.track);
        e.track.onended = () => {
          target.removeTrack(e.track);
          publishInbound(target, scopeOnly);
        };
        publishInbound(target, scopeOnly);
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") retryIce();
      };
      pc.onconnectionstatechange = () => {
        if (disposed) return;
        if (pc.connectionState === "connected") {
          clearWatchdog();
          setState("live");
        } else if (pc.connectionState === "connecting" || pc.connectionState === "new") {
          setState("connecting");
          armWatchdog();
        } else if (pc.connectionState === "failed") {
          setState("error");
          retryIce();
        } else if (pc.connectionState === "disconnected") {
          setState("waiting");
          armWatchdog();
        }
      };

      pc.onnegotiationneeded = () => void negotiate();
      pcRef.current = pc;
      syncTracks();
      return pc;
    };

    const negotiate = async () => {
      const pc = pcRef.current;
      if (!pc || !peerId) return; // nobody to talk to yet
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          const d = pc.localDescription.toJSON();
          send({ kind: "offer", sdp: { ...d, sdp: hifiAudio(d.sdp ?? "") } });
        }
        void raiseAudioBitrate(pc);
        setState((s) => (s === "live" ? s : "connecting"));

      } catch {
        /* renegotiation races settle on the next attempt */
      } finally {
        makingOffer = false;
      }
    };

    /** Push the current local tracks onto the existing senders (no re-connect). */
    function syncTracks() {
      const pc = pcRef.current;
      if (!pc) return;
      const stream = streamRef.current;
      const transceivers = pc.getTransceivers();
      const callAudio = transceivers[0];
      const callVideo = transceivers[1];
      const scopeAudio = transceivers[2];
      const replacements: Array<[RTCRtpTransceiver | undefined, MediaStreamTrack | null]> = [
        [callAudio, stream?.getAudioTracks()[0] ?? null],
        [callVideo, stream?.getVideoTracks()[0] ?? null],
        [scopeAudio, scopeStreamRef.current?.getAudioTracks()[0] ?? null],
      ];
      replacements.forEach(([transceiver, track]) => {
        if (!transceiver || transceiver.sender.track === track) return;
        void transceiver.sender.replaceTrack(track).catch(() => {});
      });
    }
    syncRef.current = syncTracks;

    const meetPeer = (id: string) => {
      if (peerId === id) return false;
      peerId = id;
      setPeerPresent(true);
      return true;
    };

    channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const msg = payload as Signal;
      if (!msg || !msg.id || msg.id === me) return;
      try {
        if (msg.kind === "hello" || msg.kind === "hi") {
          const isNew = meetPeer(msg.id);
          ensurePc();
          if (msg.kind === "hello") send({ kind: "hi" });
          send({ kind: "scope-status", scope: localScopeRef.current });
          if (isNew) await negotiate();
          return;
        }
        if (msg.kind === "scope-status" && msg.scope) {
          meetPeer(msg.id);
          setRemoteScope(msg.scope);
          return;
        }
        meetPeer(msg.id);
        const pc = ensurePc();
        if (msg.kind === "offer" && msg.sdp) {
          const collision = makingOffer || pc.signalingState !== "stable";
          ignoreOffer = !polite() && collision;
          if (ignoreOffer) return;
          await pc.setRemoteDescription({ ...msg.sdp, sdp: hifiAudio(msg.sdp.sdp ?? "") });
          syncTracks();
          await pc.setLocalDescription();
          if (pc.localDescription) {
            const d = pc.localDescription.toJSON();
            send({ kind: "answer", sdp: { ...d, sdp: hifiAudio(d.sdp ?? "") } });
          }
          void raiseAudioBitrate(pc);
          while (pending.length) await pc.addIceCandidate(pending.shift()!).catch(() => {});
          setState((s) => (s === "live" ? s : "connecting"));
        } else if (msg.kind === "answer" && msg.sdp) {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription({ ...msg.sdp, sdp: hifiAudio(msg.sdp.sdp ?? "") });
            void raiseAudioBitrate(pc);
            while (pending.length) await pc.addIceCandidate(pending.shift()!).catch(() => {});
          }

        } else if (msg.kind === "ice" && msg.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate).catch(() => {});
          else pending.push(msg.candidate);
        } else if (msg.kind === "bye") {
          peerId = null;
          teardown();
          setPeerPresent(false);
          setState("waiting");
        }
      } catch {
        /* transient negotiation races are recoverable */
      }
    });

    // Re-announce until the peer answers, so join order never matters.
    let announce: number | undefined;
    void channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      subscribedRef.current = true;
      ensurePc();
      send({ kind: "hello" });
      send({ kind: "scope-status", scope: localScopeRef.current });
      announce = window.setInterval(() => {
        if (!peerId) send({ kind: "hello" });
      }, 2500);
    });

    return () => {
      disposed = true;
      clearWatchdog();
      if (announce) window.clearInterval(announce);
      send({ kind: "bye" });
      syncRef.current = null;
      sendScopeRef.current = null;
      subscribedRef.current = false;
      void supabase.removeChannel(channel);
      teardown();
      setPeerPresent(false);
    };
  }, [enabled, roomId, role, teardown]);

  // Attach new local tracks in place whenever they change (camera ready,
  // stethoscope stream appears, camera toggled back on). onnegotiationneeded
  // takes care of the SDP exchange.
  const trackKey = localStream
    ? localStream
        .getTracks()
        .map((t) => t.id)
        .sort()
        .join(",")
    : "";
  const scopeTrackKey = localScopeStream
    ? localScopeStream
        .getAudioTracks()
        .map((track) => track.id)
        .sort()
        .join(",")
    : "";
  useEffect(() => {
    if (!enabled) return;
    syncRef.current?.();
  }, [enabled, trackKey, scopeTrackKey]);

  useEffect(() => {
    if (!enabled || !subscribedRef.current) return;
    sendScopeRef.current?.(localScope);
  }, [enabled, localScope.connected, localScope.capturing]);

  return { state, remoteStream, remoteScopeStream, peerPresent, remoteScope };
}
