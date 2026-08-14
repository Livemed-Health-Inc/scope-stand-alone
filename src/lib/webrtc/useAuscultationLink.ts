import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LinkRole = "patient" | "remote";
export type LinkState = "idle" | "waiting" | "connecting" | "live" | "error";

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
  kind: "hello" | "hi" | "offer" | "answer" | "ice" | "bye";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

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
}) {
  const { roomId, role, enabled, localStream } = opts;
  const [state, setState] = useState<LinkState>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerPresent, setPeerPresent] = useState(false);

  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = newId();
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = localStream;
  const syncRef = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setRemoteStream(null);
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

    const inbound = new MediaStream();

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
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ kind: "ice", candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        inbound.addTrack(e.track);
        e.track.onended = () => {
          inbound.removeTrack(e.track);
          setRemoteStream(inbound.getTracks().length ? new MediaStream(inbound.getTracks()) : null);
        };
        setRemoteStream(new MediaStream(inbound.getTracks()));
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
      // Always be ready to receive one audio + one video track.
      pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "sendrecv" });
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
        if (pc.localDescription) send({ kind: "offer", sdp: pc.localDescription.toJSON() });
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
      const audioWanted: MediaStreamTrack[] = stream?.getAudioTracks() ?? [];
      const videoWanted: MediaStreamTrack[] = stream?.getVideoTracks() ?? [];
      const attached = new Set(
        pc.getSenders().map((s) => s.track).filter(Boolean) as MediaStreamTrack[],
      );
      const pendingAudio = audioWanted.filter((t) => !attached.has(t));
      const pendingVideo = videoWanted.filter((t) => !attached.has(t));
      const pendingFor = (kind: string) => (kind === "audio" ? pendingAudio : pendingVideo);
      const wantedFor = (kind: string) => (kind === "audio" ? audioWanted : videoWanted);
      pc.getTransceivers().forEach((tr) => {
        const kind = tr.sender.track?.kind ?? tr.receiver.track?.kind;
        if (!kind || tr.currentDirection === "stopped") return;
        const current = tr.sender.track;
        if (current && wantedFor(kind).includes(current)) return;
        const next = pendingFor(kind).shift() ?? null;
        if (next === current) return;
        void tr.sender.replaceTrack(next).catch(() => {});
        if (next) attached.add(next);
      });
      if (stream) {
        [...pendingAudio, ...pendingVideo].forEach((t) => {
          if (attached.has(t)) return;
          try {
            pc.addTrack(t, stream);
            attached.add(t);
          } catch {
            /* already attached */
          }
        });
      }
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
          if (isNew) await negotiate();
          return;
        }
        meetPeer(msg.id);
        const pc = ensurePc();
        if (msg.kind === "offer" && msg.sdp) {
          const collision = makingOffer || pc.signalingState !== "stable";
          ignoreOffer = !polite() && collision;
          if (ignoreOffer) return;
          await pc.setRemoteDescription(msg.sdp);
          syncTracks();
          await pc.setLocalDescription();
          if (pc.localDescription) send({ kind: "answer", sdp: pc.localDescription.toJSON() });
          while (pending.length) await pc.addIceCandidate(pending.shift()!).catch(() => {});
          setState((s) => (s === "live" ? s : "connecting"));
        } else if (msg.kind === "answer" && msg.sdp) {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(msg.sdp);
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
      ensurePc();
      send({ kind: "hello" });
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
  useEffect(() => {
    if (!enabled) return;
    syncRef.current?.();
  }, [enabled, trackKey]);

  return { state, remoteStream, peerPresent };
}
