import { useCallback, useEffect, useState } from "react";
import { PhoneIncoming, PhoneOff, Coffee, CheckCircle2, BellRing, Footprints } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { setDoctorPresence } from "@/lib/staff";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { VideoVisit } from "@/features/video-visit";
import { startRinging, stopRinging, startAlerting, stopAlerting, primeAudio } from "@/lib/ringtone";

type Call = {
  id: string;
  nurse_id: string | null;
  status: string;
  patient_room: string | null;
  reason: string | null;
  hospital: string | null;
  unit: string | null;
  created_at: string;
};

type Ack = {
  id: string;
  hospital: string;
  unit: string;
  room: string;
  note: string | null;
  created_at: string;
};

export function DoctorStation() {
  const { user, profile, role, loading, signOut } = useAuth();
  const [available, setAvailable] = useState(true);
  const [readyToRound, setReadyToRound] = useState(false);
  const [presenceLoaded, setPresenceLoaded] = useState(false);
  const [acks, setAcks] = useState<Ack[]>([]);
  const [incoming, setIncoming] = useState<Call[]>([]);
  const [active, setActive] = useState<Call | null>(null);
  const [nurseNames, setNurseNames] = useState<Record<string, string>>({});
  const loadCalls = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("calls")
      .select("id, nurse_id, status, patient_room, reason, hospital, unit, created_at")
      .eq("doctor_id", user.id)
      .in("status", ["ringing", "accepted"])
      .order("created_at", { ascending: true });
    const calls = (data ?? []) as Call[];
    setIncoming(calls.filter((c) => c.status === "ringing"));
    setActive(calls.find((c) => c.status === "accepted") ?? null);

    const missing = calls
      .map((c) => c.nurse_id)
      .filter((id): id is string => !!id && !nurseNames[id]);
    if (missing.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, unit").in("id", missing);
      setNurseNames((prev) => {
        const next = { ...prev };
        (profs ?? []).forEach((p) => (next[p.id] = p.full_name));
        return next;
      });
    }
  }, [user, nurseNames]);

  useEffect(() => {
    primeAudio();
  }, []);

  useEffect(() => {
    if (!user || role !== "doctor") return;
    let active = true;
    void supabase
      .from("doctor_presence")
      .select("is_online, ready_to_round")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toast.error("Could not load physician status");
        setAvailable(data?.is_online ?? true);
        setReadyToRound(data?.ready_to_round ?? false);
        setPresenceLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user, role]);

  // Nurse acknowledgements: carts staged and ready for rounds
  const loadAcks = useCallback(async () => {
    const { data } = await supabase
      .from("rounding_queue")
      .select("id, hospital, unit, room, note, created_at")
      .eq("status", "ready")
      .order("created_at", { ascending: true });
    setAcks((data ?? []) as Ack[]);
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadAcks();
    const channel = supabase
      .channel("doctor-rounding")
      .on("postgres_changes", { event: "*", schema: "public", table: "rounding_queue" }, () => void loadAcks())
      .subscribe();
    const poll = window.setInterval(() => void loadAcks(), 5000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [user, loadAcks]);

  // Chime while carts are staged and waiting (paced, not frantic)
  useEffect(() => {
    if (acks.length > 0 && !active && incoming.length === 0) startAlerting(20000);
    else stopAlerting();
    return () => stopAlerting();
  }, [acks.length, active, incoming.length]);

  async function clearAck(id: string) {
    stopAlerting();
    await supabase
      .from("rounding_queue")
      .update({ status: "cleared", cleared_at: new Date().toISOString(), cleared_by: user?.id ?? null })
      .eq("id", id);
    setAcks((a) => a.filter((x) => x.id !== id));
  }

  // Presence heartbeat only reports availability and consult state.
  // ready_to_round is changed exclusively by the alert button so an older
  // interval closure cannot overwrite a newly-sent rounding alert.
  useEffect(() => {
    if (!user || role !== "doctor" || !presenceLoaded) return;
    const userId = user.id;
    const patch = { is_online: available, in_consult: Boolean(active) };
    void setDoctorPresence(userId, patch).catch(() => toast.error("Could not update physician status"));
    const beat = window.setInterval(() => {
      void setDoctorPresence(userId, patch).catch(() => undefined);
    }, 15000);
    return () => {
      window.clearInterval(beat);
    };
  }, [user, role, presenceLoaded, available, active]);


  useEffect(() => {
    if (!user) return;
    void loadCalls();
    const channel = supabase
      .channel(`doctor-calls-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `doctor_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as Call | undefined;
          if (payload.eventType === "INSERT" && row?.status === "ringing") {
            toast.info("Incoming consult request");
          }
          void loadCalls();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  // Fallback poll in case a realtime event is missed
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => void loadCalls(), 4000);
    return () => window.clearInterval(id);
  }, [user, loadCalls]);

  // Audible ring while a request is pending
  useEffect(() => {
    if (incoming.length > 0 && !active) startRinging();
    else stopRinging();
    return () => stopRinging();
  }, [incoming.length, active]);

  async function accept(call: Call) {
    stopRinging();
    await supabase
      .from("calls")
      .update({ status: "accepted", answered_at: new Date().toISOString() })
      .eq("id", call.id);
    setActive({ ...call, status: "accepted" });
    setIncoming((c) => c.filter((x) => x.id !== call.id));
  }

  async function decline(call: Call) {
    stopRinging();
    await supabase.from("calls").update({ status: "declined", ended_at: new Date().toISOString() }).eq("id", call.id);
    setIncoming((c) => c.filter((x) => x.id !== call.id));
  }

  async function end() {
    if (!active) return;
    await supabase.from("calls").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", active.id);
    setActive(null);
  }

  if (active) {
    return (
      <VideoVisit
        roomId={active.id}
        role="remote"
        patient={(active.nurse_id && nurseNames[active.nurse_id]) || "Bedside nurse"}
        room={active.patient_room ? `Room ${active.patient_room}` : ""}
        hospital={active.hospital ?? "Virtualis General Hospital"}
        unit={active.unit ?? "ICU - 4 West"}
        title={active.reason ?? "Virtual consult"}
        callerName={profile?.full_name ? `Dr. ${profile.full_name}` : "Physician"}
        allowRemoteLocalScope
        onEnd={end}
      />
    );
  }

  if (loading) {
    return <div className="panel-surface p-8 text-center text-sm text-muted-foreground">Loading your station…</div>;
  }

  if (role !== "doctor") {
    return (
      <div className="panel-surface p-8 text-center">
        <h1 className="text-xl font-semibold">Physician access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {user?.email ? <>You are signed in as {user.email}, which </> : <>This login </>}
          is not assigned as a physician, so it cannot send rounding alerts. Ask an admin to assign the physician role,
          or sign in with your physician account.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    );
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-caps">Virtual waiting room</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dr. {profile?.full_name}</h1>
          <p className="text-sm text-muted-foreground">{profile?.specialty ?? "Physician"}</p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-panel/70 px-3 py-2">
          <Switch checked={available} onCheckedChange={setAvailable} id="avail" />
          <label htmlFor="avail" className="text-sm font-medium">
            {available ? "Available for consults" : "Do not disturb"}
          </label>
          <Badge className={available ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}>
            {available ? "Online" : "Offline"}
          </Badge>
        </div>
      </div>

      <div className="panel-surface flex flex-wrap items-center gap-4 p-4">
        <div
          className={`flex size-12 items-center justify-center rounded-full ${
            readyToRound ? "bg-warning/15 text-warning ring-pulse" : "bg-muted text-muted-foreground"
          }`}
        >
          <Footprints className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Ready to round</p>
          <p className="text-sm text-muted-foreground">
            {readyToRound
              ? "Bedside stations are being alerted until a nurse acknowledges and stages the cart."
              : "Alert every bedside station that you're ready to start rounds."}
          </p>
        </div>
        <Button
          variant={readyToRound ? "secondary" : "default"}
          className="gap-2"
          disabled={!available}
          onClick={async () => {
            const next = !readyToRound;
            if (!user) return;
            try {
              await setDoctorPresence(user.id, {
                is_online: available,
                in_consult: Boolean(active),
                ready_to_round: next,
              });
              setReadyToRound(next);
              toast[next ? "success" : "info"](next ? "Nurses are being alerted" : "Rounding alert stopped");
            } catch {
              toast.error("The rounding alert could not be sent");
            }
          }}
        >
          <BellRing className="size-4" /> {readyToRound ? "Stop alert" : "Alert nurses"}
        </Button>
      </div>

      {acks.length > 0 && (
        <ul className="space-y-3">
          {acks.map((a) => (
            <li
              key={a.id}
              className="panel-surface flex flex-wrap items-center gap-4 p-4 ring-1 ring-success/40"
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success ring-pulse">
                <CheckCircle2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">Cart is ready to round — Room {a.room}</p>
                <p className="text-xs font-medium text-foreground/80">{a.hospital}</p>
                <p className="text-xs text-muted-foreground">{a.unit}</p>
                {a.note && <p className="mt-1 text-sm text-foreground/90">{a.note}</p>}
              </div>
              <Button variant="secondary" onClick={() => void clearAck(a.id)}>
                Acknowledge
              </Button>
            </li>
          ))}
        </ul>
      )}



      {incoming.length === 0 ? (
        <div className="panel-surface flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary ring-pulse">
            <Coffee className="size-7" />
          </div>
          <p className="font-medium">You're in the waiting room</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {available
              ? "Nurses can see you as online. Incoming consult requests will appear here instantly."
              : "You're marked offline — nurses can't reach you until you switch back to available."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {incoming.map((call) => (
            <li key={call.id} className="panel-surface flex flex-wrap items-center gap-4 p-4 ring-1 ring-primary/30">
              <div className="flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive ring-pulse">
                <PhoneIncoming className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{(call.nurse_id && nurseNames[call.nurse_id]) || "Bedside nurse"}</p>
                <p className="text-xs font-medium text-foreground/80">
                  {call.hospital ?? "Virtualis General Hospital"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {call.unit ?? "ICU - 4 West"} · Room {call.patient_room ?? "412-B"}
                </p>
                {call.reason && <p className="mt-1 text-sm text-foreground/90">{call.reason}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => decline(call)} className="gap-2">
                  <PhoneOff className="size-4" /> Decline
                </Button>
                <Button onClick={() => accept(call)} className="gap-2">
                  <CheckCircle2 className="size-4" /> Accept
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
