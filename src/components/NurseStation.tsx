import { useEffect, useMemo, useState } from "react";
import { PhoneCall, Loader2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VideoVisit } from "@/features/video-visit";

type Doctor = {
  id: string;
  full_name: string;
  specialty: string | null;
  is_online: boolean;
  in_consult: boolean;
};

type DoctorPresence = {
  user_id: string;
  is_online: boolean;
  in_consult: boolean;
  last_seen: string;
};

type Call = {
  id: string;
  doctor_id: string;
  status: string;
  patient_room: string | null;
  reason: string | null;
};

export function NurseStation() {
  const { user, profile } = useAuth();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Doctor | null>(null);
  const [room, setRoom] = useState("412-B");
  const [reason, setReason] = useState("");
  const [activeCall, setActiveCall] = useState<Call | null>(null);

  async function loadDoctors() {
    const { data } = await supabase.rpc("on_call_directory");
    const freshAfter = Date.now() - 45_000;
    setDoctors(
      (data ?? []).map((d) => {
        const isFresh = d.last_seen ? new Date(d.last_seen).getTime() >= freshAfter : false;
        return {
          id: d.id,
          full_name: d.full_name,
          specialty: d.specialty,
          is_online: Boolean(d.is_online && isFresh),
          in_consult: Boolean(d.in_consult && isFresh),
        };
      }),
    );
    setLoading(false);
  }


  useEffect(() => {
    void loadDoctors();
    const channel = supabase
      .channel("nurse-presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "doctor_presence" }, () => void loadDoctors())
      .subscribe();
    const refresh = window.setInterval(() => void loadDoctors(), 15000);
    return () => {
      window.clearInterval(refresh);
      void supabase.removeChannel(channel);
    };
  }, []);

  // Watch our outgoing call (status polled through a scoped endpoint)
  useEffect(() => {
    if (!activeCall) return;
    const callId = activeCall.id;
    const poll = window.setInterval(async () => {
      const { data } = await supabase.rpc("get_public_call", { _call_id: callId });
      const next = (data ?? [])[0] as Call | undefined;
      if (!next) return;
      setActiveCall((prev) => {
        if (!prev || prev.status === next.status) return prev;
        if (next.status === "declined") toast.error("Call declined — try another physician.");
        if (next.status === "accepted") toast.success("Physician connected.");
        if (next.status === "ended") return null;
        return next;
      });
    }, 2000);
    return () => window.clearInterval(poll);
  }, [activeCall?.id]);

  const online = useMemo(() => doctors.filter((d) => d.is_online).length, [doctors]);

  async function placeCall() {
    if (!target) return;
    if (target.in_consult) {
      toast.warning(`Dr. ${target.full_name} is currently in a consult — please hold.`);
      return;
    }
    const { data, error } = await supabase.rpc("place_public_call", {
      _doctor_id: target.id,
      _patient_room: room,
      _reason: reason || undefined,
      _hospital: profile?.hospital ?? undefined,
      _unit: profile?.unit ?? undefined,
    });
    if (error || !data) {
      toast.error(error?.message ?? "Could not place the call.");
      return;
    }
    setActiveCall({
      id: data as string,
      doctor_id: target.id,
      status: "ringing",
      patient_room: room,
      reason: reason || null,
    });
    setTarget(null);
    setReason("");
  }

  async function cancelCall() {
    if (!activeCall) return;
    await supabase.rpc("end_public_call", { _call_id: activeCall.id });
    setActiveCall(null);
  }


  if (activeCall?.status === "accepted") {
    const doc = doctors.find((d) => d.id === activeCall.doctor_id);
    const docName = doc ? (/^dr\.?\s/i.test(doc.full_name) ? doc.full_name : `Dr. ${doc.full_name}`) : "Physician";
    return (
      <VideoVisit
        roomId={activeCall.id}
        role="patient"
        patient={docName}
        room={activeCall.patient_room ? `Room ${activeCall.patient_room}` : ""}
        title={activeCall.reason ?? "Virtual consult"}
        callerName="Bedside nurse"
        onEnd={cancelCall}
      />
    );
  }


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="label-caps">Physician directory</p>
          <h1 className="text-2xl font-semibold tracking-tight">On-call physicians</h1>
        </div>
        <Badge className="gap-1.5 bg-success/15 text-success">
          <Users className="size-3.5" /> {online} online
        </Badge>
      </div>

      {activeCall && activeCall.status === "ringing" && (
        <div className="panel-surface flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div>
              <p className="font-medium">
                Ringing {doctors.find((d) => d.id === activeCall.doctor_id)?.full_name ?? "physician"}…
              </p>
              <p className="text-xs text-muted-foreground">Room {activeCall.patient_room} · waiting for pickup</p>
            </div>
          </div>
          <Button variant="secondary" onClick={cancelCall} className="gap-2">
            <X className="size-4" /> Cancel
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading directory…</p>
      ) : doctors.length === 0 ? (
        <div className="panel-surface p-8 text-center text-sm text-muted-foreground">
          No physicians registered yet. A physician account must be created to appear here.
        </div>
      ) : (
        <ul className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {doctors.map((d) => (
            <li key={d.id} className="panel-surface flex items-center gap-4 p-4">
              <div className="relative">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">
                  {d.full_name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card ${
                    d.in_consult ? "bg-warning" : d.is_online ? "bg-success" : "bg-muted-foreground"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">Dr. {d.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">{d.specialty ?? "Physician"}</p>
                <p
                  className={`mt-1 text-[0.68rem] font-semibold uppercase tracking-widest ${
                    d.in_consult ? "text-warning" : d.is_online ? "text-success" : "text-muted-foreground"
                  }`}
                >
                  {d.in_consult ? "In consult" : d.is_online ? "Online" : "Offline"}
                </p>
              </div>
              <Button
                onClick={() => (d.in_consult ? toast.warning(`Dr. ${d.full_name} is in a consult — please hold.`) : setTarget(d))}
                disabled={!d.is_online || !!activeCall}
                className="gap-2"
              >
                <PhoneCall className="size-4" /> Call
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call Dr. {target?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="room">Patient room</Label>
              <Input id="room" value={room} onChange={(e) => setRoom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="reason">Reason for consult</Label>
              <Input
                id="reason"
                placeholder="Irregular heart sounds, desat to 88%"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button className="w-full gap-2" onClick={placeCall}>
              <PhoneCall className="size-4" /> Place call
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
