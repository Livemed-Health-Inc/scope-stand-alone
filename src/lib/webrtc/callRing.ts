import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHANNEL = "virtualis:calls";
const RING_EVERY = 2000;
const STALE_AFTER = 6000;

export type CallRing = {
  consultId: string;
  patient: string;
  room: string;
  caller: string;
};

type RingMsg = { kind: "ring" | "cancel" | "accept" } & CallRing;

/** Patient-side: keeps ringing the doctor until the call connects. */
export function useOutgoingRing(ring: CallRing | null, active: boolean) {
  useEffect(() => {
    if (!active || !ring) return;
    const channel = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } });
    const send = (kind: RingMsg["kind"]) =>
      void channel.send({ type: "broadcast", event: "call", payload: { kind, ...ring } });
    let timer: number | undefined;
    void channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      send("ring");
      timer = window.setInterval(() => send("ring"), RING_EVERY);
    });
    return () => {
      if (timer) window.clearInterval(timer);
      send("cancel");
      void supabase.removeChannel(channel);
    };
  }, [active, ring?.consultId, ring?.patient, ring?.room, ring?.caller]);
}

/** Doctor-side: incoming call state, cleared when the nurse hangs up or it goes stale. */
export function useIncomingCall(enabled: boolean) {
  const [call, setCall] = useState<CallRing | null>(null);
  const lastRef = useRef(0);
  const dismissedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCall(null);
      return;
    }
    const channel = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "call" }, ({ payload }) => {
      const msg = payload as RingMsg;
      if (!msg?.consultId) return;
      if (msg.kind === "ring") {
        if (dismissedRef.current === msg.consultId) return;
        lastRef.current = Date.now();
        setCall({
          consultId: msg.consultId,
          patient: msg.patient,
          room: msg.room,
          caller: msg.caller,
        });
      } else {
        dismissedRef.current = null;
        setCall((c) => (c?.consultId === msg.consultId ? null : c));
      }
    });
    void channel.subscribe();
    const sweep = window.setInterval(() => {
      if (lastRef.current && Date.now() - lastRef.current > STALE_AFTER) setCall(null);
    }, 1500);
    return () => {
      window.clearInterval(sweep);
      window.clearTimeout(sweep);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  const dismiss = () => {
    if (call) dismissedRef.current = call.consultId;
    setCall(null);
  };

  return { call, dismiss };
}

/** Simple two-tone ringtone using Web Audio (no asset needed). */
export function useRingtone(playing: boolean) {
  useEffect(() => {
    if (!playing) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const beep = () => {
      if (!ctx || ctx.state === "closed") return;
      [880, 660].forEach((f, i) => {
        const o = ctx!.createOscillator();
        const g = ctx!.createGain();
        o.frequency.value = f;
        o.type = "sine";
        const t = ctx!.currentTime + i * 0.32;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.15, t + 0.03);
        g.gain.linearRampToValueAtTime(0, t + 0.28);
        o.connect(g).connect(ctx!.destination);
        o.start(t);
        o.stop(t + 0.3);
      });
    };
    void ctx.resume().catch(() => {});
    beep();
    const timer = window.setInterval(beep, 2400);
    return () => {
      window.clearInterval(timer);
      void ctx?.close().catch(() => {});
    };
  }, [playing]);
}
