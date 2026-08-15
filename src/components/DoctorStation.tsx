import { useCallback, useEffect, useState } from "react";
import { PhoneIncoming, PhoneOff, Coffee, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { setDoctorPresence } from "@/lib/staff";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoundingBoard } from "@/components/RoundingBoard";
import { VideoVisit } from "@/features/video-visit";
import { startRinging, stopRinging } from "@/lib/ringtone";

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

export function DoctorStation() {
  const { user, profile } = useAuth();
  const [available, setAvailable] = useState(true);
  const [rounding, setRounding] = useState(false);
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

  // Presence: online while on this screen and available
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    void setDoctorPresence(userId, { is_online: available, in_consult: !!active });
    const beat = window.setInterval(() => {
      void setDoctorPresence(userId, { is_online: available, in_consult: !!active });
    }, 15000);
    return () => {
      window.clearInterval(beat);
    };
  }, [user, available, active]);


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


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-caps">Virtual waiting room</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dr. {profile?.full_name}</h1>
          <p className="text-sm text-muted-foreground">{profile?.specialty ?? "Physician"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-panel/70 px-3 py-2">
            <Switch checked={available} onCheckedChange={setAvailable} id="avail" />
            <label htmlFor="avail" className="text-sm font-medium">
              {available ? "Available for consults" : "Do not disturb"}
            </label>
            <Badge className={available ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}>
              {available ? "Online" : "Offline"}
            </Badge>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-panel/70 px-3 py-2">
            <Switch checked={rounding} onCheckedChange={setRounding} id="rounding" />
            <label htmlFor="rounding" className="text-sm font-medium">
              {rounding ? "Ready to round" : "Not rounding"}
            </label>
          </div>
        </div>

      </div>

      <Tabs defaultValue="consults">
        <TabsList>
          <TabsTrigger value="consults">Consults</TabsTrigger>
          <TabsTrigger value="rounding">Rounding</TabsTrigger>
        </TabsList>

        <TabsContent value="consults" className="mt-4">
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
        </TabsContent>

        <TabsContent value="rounding" className="mt-4">
          {rounding ? (
            <RoundingBoard />
          ) : (
            <div className="panel-surface p-10 text-center text-sm text-muted-foreground">
              Flip “Ready to round” on to see rooms waiting for rounding.
            </div>
          )}
        </TabsContent>

      </Tabs>
    </div>

  );
}
