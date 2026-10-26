import { useEffect, useRef, useState } from "react";
import { PhoneIncoming, PhoneOff, CheckCircle2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceToken } from "@/lib/device";
import { Button } from "@/components/ui/button";
import { startRinging, stopRinging } from "@/lib/ringtone";

import { dropInRemaining } from "@/components/dropIn";

export type DoctorInitiatedCall = {
  id: string;
  doctor_id: string;
  doctor_name: string;
  specialty: string | null;
  mode: string;
};


export function IncomingDoctorCall({
  paused,
  onAccepted,
}: {
  paused: boolean;
  onAccepted: (call: DoctorInitiatedCall) => void;
}) {
  const [call, setCall] = useState<DoctorInitiatedCall | null>(null);
  const [seenAt, setSeenAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const poll = async () => {
      const token = getDeviceToken();
      if (!token) return;
      const { data } = await supabase.rpc("device_incoming_call", { _device_token: token });
      if (!alive) return;
      const next = ((data ?? [])[0] as DoctorInitiatedCall | undefined) ?? null;
      setCall((prev) => {
        if (!next || dismissed.current.has(next.id)) return null;
        if (prev?.id !== next.id) setSeenAt(Date.now());
        return next;
      });
    };
    void poll();
    const id = window.setInterval(() => void poll(), 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [paused]);

  useEffect(() => {
    if (!call) return;
    startRinging();
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(t);
      stopRinging();
    };
  }, [call?.id]);

  async function answer(accept: boolean) {
    if (!call) return;
    const c = call;
    dismissed.current.add(c.id);
    setCall(null);
    stopRinging();
    const token = getDeviceToken();
    if (!token) return;
    await supabase.rpc("answer_public_call", { _device_token: token, _call_id: c.id, _accept: accept });
    if (accept) onAccepted(c);
  }

  const remaining = call?.mode === "drop_in" ? dropInRemaining(seenAt, now) : null;
  useEffect(() => {
    if (remaining === 0) void answer(true);
  }, [remaining]);

  if (!call || paused) return null;
  const name = /^dr\.?\s/i.test(call.doctor_name) ? call.doctor_name : `Dr. ${call.doctor_name}`;
  const dropIn = call.mode === "drop_in";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur">
      <div className="glass-card w-full max-w-lg space-y-5 p-8 text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/15 text-primary ring-pulse">
          {dropIn ? <Eye className="size-9" /> : <PhoneIncoming className="size-9" />}
        </div>
        <div>
          <p className="label-caps">{dropIn ? "Physician drop-in" : "Incoming physician call"}</p>
          <h2 className="mt-1 text-2xl font-semibold">{name}</h2>
          {call.specialty && <p className="text-sm text-muted-foreground">{call.specialty}</p>}
        </div>
        {dropIn && (
          <p className="text-lg">
            {name} is dropping in — video connects in <span className="font-semibold">{remaining}s</span>
          </p>
        )}
        <div className="flex justify-center gap-3">
          <Button size="lg" variant="secondary" className="gap-2" onClick={() => void answer(false)}>
            <PhoneOff className="size-4" /> Decline
          </Button>
          <Button size="lg" className="gap-2" onClick={() => void answer(true)}>
            <CheckCircle2 className="size-4" /> {dropIn ? "Connect now" : "Answer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
