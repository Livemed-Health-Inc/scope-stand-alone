import { useEffect, useMemo, useState, type ElementType } from "react";
import {
  PhoneCall,
  Loader2,
  Users,
  X,
  Stethoscope,
  ChevronRight,
  BellRing,
  CheckCircle2,
  HeartPulse,
  Wind,
  Brain,
  ShieldAlert,
  Droplets,
  Activity,
  Building2,
  Clock,
  UserX,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { auditLog } from "@/lib/audit";
import { getDeviceToken, type DeviceContext } from "@/lib/device";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VideoVisit } from "@/features/video-visit";
import { startAlerting, stopAlerting, primeAudio } from "@/lib/ringtone";

type Doctor = {
  id: string;
  full_name: string;
  specialty: string | null;
  is_online: boolean;
  in_consult: boolean;
  ready_to_round: boolean;
};

type Staged = { id: string; room: string; note: string | null };

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
  hospital: string | null;
  unit: string | null;
};

const SPECIALTIES = [
  { name: "Cardiology", keywords: ["cardio", "heart"] },
  { name: "Pulmonology", keywords: ["pulmon", "lung", "respir"] },
  { name: "Neurology", keywords: ["neuro"] },
  { name: "Infectious Disease", keywords: ["infect", "id"] },
  { name: "Nephrology", keywords: ["nephro", "renal", "kidney"] },
  { name: "Critical Care", keywords: ["critical", "intensiv", "icu"] },
  { name: "Hospitalist", keywords: ["hospitalist", "internal", "medicine"] },
] as const;

const MOCK_DOCTORS: Record<string, string[]> = {
  Cardiology: ["Amara Osei", "Daniel Reyes"],
  Pulmonology: ["Priya Raman", "Grant Whitfield"],
  Neurology: ["Lena Kowalski", "Marcus Bell"],
  "Infectious Disease": ["Yusuf Karim", "Elise Tran"],
  Nephrology: ["Hannah Choi", "Victor Alvarez"],
  "Critical Care": ["Simone Adeyemi", "Peter Lindqvist"],
  Hospitalist: ["Nina Duarte", "Owen Blackwell"],
};

const SPECIALTY_ICONS: Record<string, ElementType<{ className?: string }>> = {
  Cardiology: HeartPulse,
  Pulmonology: Wind,
  Neurology: Brain,
  "Infectious Disease": ShieldAlert,
  Nephrology: Droplets,
  "Critical Care": Activity,
  Hospitalist: Building2,
};

function specialtyFor(specialty: string | null): string {
  const s = (specialty ?? "").toLowerCase();
  const hit = SPECIALTIES.find((sp) => sp.keywords.some((k) => s.includes(k)));
  return hit?.name ?? "Hospitalist";
}

function statusFor(d: Doctor) {
  if (d.in_consult) return { label: "In consult", color: "warning" as const, icon: Clock };
  if (d.is_online) return { label: "Online · Available", color: "success" as const, icon: Radio };
  return { label: "Offline", color: "muted" as const, icon: UserX };
}

export function NurseStation({ device }: { device: DeviceContext }) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [target, setTarget] = useState<Doctor | null>(null);
  const [room, setRoom] = useState("412-B");
  const [reason, setReason] = useState("");
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [ackOpen, setAckOpen] = useState(false);
  const [roundRoom, setRoundRoom] = useState("412-B");

  async function loadStaged() {
    const token = getDeviceToken();
    if (!token) return;
    const { data } = await supabase.rpc("device_rounding", { _device_token: token });
    setStaged(((data ?? []) as Staged[]).map((r) => ({ id: r.id, room: r.room, note: r.note })));
  }

  async function acknowledgeRounding() {
    const token = getDeviceToken();
    if (!token) return;
    const { error } = await supabase.rpc("mark_rounding_ready", {
      _device_token: token,
      _room: roundRoom,
      _note: "Cart staged at bedside",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    stopAlerting();
    setAckOpen(false);
    toast.success("Physician notified \u2014 cart is ready to round");
    void loadStaged();
  }

  async function clearStaged(id: string) {
    const token = getDeviceToken();
    if (!token) return;
    await supabase.rpc("clear_rounding", { _device_token: token, _id: id });
    void loadStaged();
  }

  async function loadDoctors() {
    const token = getDeviceToken();
    if (!token) return;
    const { data } = await supabase.rpc("on_call_directory", { _device_token: token });
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
          ready_to_round: Boolean(d.ready_to_round && isFresh),
        };
      }),
    );
    setLoading(false);
  }

  useEffect(() => {
    void loadDoctors();
    void loadStaged();
    const channel = supabase
      .channel("nurse-presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "doctor_presence" }, () => void loadDoctors())
      .subscribe();
    const refresh = window.setInterval(() => {
      void loadDoctors();
      void loadStaged();
    }, 10000);
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
      const token = getDeviceToken();
      if (!token) return;
      const { data } = await supabase.rpc("get_public_call", { _device_token: token, _call_id: callId });
      const next = (data ?? [])[0] as Call | undefined;
      if (!next) return;
      setActiveCall((prev) => {
        if (!prev || prev.status === next.status) return prev;
        if (next.status === "declined") toast.error("Call declined \u2014 try another physician.");
        if (next.status === "accepted") toast.success("Physician connected.");
        if (next.status === "ended") return null;
        return next;
      });
    }, 2000);
    return () => window.clearInterval(poll);
  }, [activeCall?.id]);

  const online = useMemo(() => doctors.filter((d) => d.is_online).length, [doctors]);
  const roundingDocs = useMemo(() => doctors.filter((d) => d.ready_to_round && d.is_online), [doctors]);
  const alerting = roundingDocs.length > 0 && staged.length === 0 && !activeCall;

  useEffect(() => {
    primeAudio();
  }, []);

  // Repeating chime until the nurse acknowledges the rounding request
  useEffect(() => {
    if (alerting) startAlerting(15000);
    else stopAlerting();
    return () => stopAlerting();
  }, [alerting]);

  async function placeCall() {
    if (!target) return;
    if (target.in_consult) {
      toast.warning(`Dr. ${target.full_name} is currently in a consult \u2014 please hold.`);
      return;
    }
    const token = getDeviceToken();
    if (!token) {
      toast.error("This device is no longer registered.");
      return;
    }
    const { data, error } = await supabase.rpc("place_public_call", {
      _device_token: token,
      _doctor_id: target.id,
      _patient_room: room,
      ...(reason ? { _reason: reason } : {}),
    });

    if (error || !data) {
      void auditLog({ action: "consult.placed", entity: "calls", outcome: "error", withDevice: true });
      toast.error(error?.message ?? "Could not place the call.");
      return;
    }
    void auditLog({
      action: "consult.placed",
      entity: "calls",
      entityId: data as string,
      phi: true,
      withDevice: true,
    });
    setActiveCall({
      id: data as string,
      doctor_id: target.id,
      status: "ringing",
      patient_room: room,
      reason: reason || null,
      hospital: device.hospital,
      unit: device.unit,
    });
    setTarget(null);
    setReason("");
  }

  async function cancelCall() {
    if (!activeCall) return;
    const token = getDeviceToken();
    if (token) await supabase.rpc("end_public_call", { _device_token: token, _call_id: activeCall.id });
    setActiveCall(null);
  }

  if (activeCall?.status === "accepted") {
    const doc = doctors.find((d) => d.id === activeCall.doctor_id);
    const docName = doc ? (/^dr\.?\s/i.test(doc.full_name) ? doc.full_name : `Dr. ${doc.full_name}`) : "Physician";
    return (
      <VideoVisit
        roomId={activeCall.id}
        callId={activeCall.id}

        role="patient"
        patient={docName}
        room={activeCall.patient_room ? `Room ${activeCall.patient_room}` : ""}
        hospital={activeCall.hospital ?? "Virtualis General Hospital"}
        unit={activeCall.unit ?? "ICU - 4 West"}
        title={activeCall.reason ?? "Virtual consult"}
        callerName="Bedside nurse"
        onEnd={cancelCall}
      />
    );
  }

  const bySpecialty = SPECIALTIES.map((sp) => {
    const real = doctors.filter((d) => specialtyFor(d.specialty) === sp.name);
    const mocks: Doctor[] = (MOCK_DOCTORS[sp.name] ?? []).map((n, i) => ({
      id: `mock:${sp.name}:${i}`,
      full_name: n,
      specialty: sp.name,
      is_online: i === 0,
      in_consult: false,
      ready_to_round: false,
    }));
    return { name: sp.name, doctors: [...real, ...mocks] };
  });

  const current = bySpecialty.find((s) => s.name === selectedSpecialty);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="glass-card -mx-4 rounded-none border-x-0 border-l-4 border-l-primary px-4 py-5 sm:-mx-0 sm:rounded-xl sm:border-x sm:border-l-primary">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="label-caps">{device.hospital}</p>
            <h2 className="text-xl font-semibold tracking-tight">{device.unit}</h2>
          </div>
          <Badge variant="outline" className="w-fit gap-2 border-success/30 bg-success/10 text-success">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            {online} online
          </Badge>
        </div>
      </div>

      {alerting && (
        <div
          className="glass-card flex flex-wrap items-center gap-4 border-l-4 border-l-warning p-5 ring-1 ring-warning/30"
          onClick={() => primeAudio()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") primeAudio();
          }}
        >
          <div className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning ring-pulse-soft">
            <BellRing className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">
              {roundingDocs.length === 1
                ? `Dr. ${roundingDocs[0]!.full_name} is ready to round`
                : `${roundingDocs.length} physicians are ready to round`}
            </p>
            <p className="text-sm text-muted-foreground">
              Acknowledge and stage the cart at the bedside — the physician will be notified.
            </p>
          </div>
          <Button size="lg" className="gap-2" onClick={() => setAckOpen(true)}>
            <CheckCircle2 className="size-5" /> Acknowledge
          </Button>
        </div>
      )}

      {staged.length > 0 && (
        <ul className="flex flex-col gap-3">
          {staged.map((s) => (
            <li key={s.id} className="glass-card flex items-center gap-4 border-l-4 border-l-success p-4">
              <CheckCircle2 className="size-5 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Cart staged — Room {s.room}</p>
                <p className="text-xs text-muted-foreground">Physician has been notified you&apos;re ready to round.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void clearStaged(s.id)}>
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="label-caps">{current ? "Available for consult" : "Consult directory"}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{current ? current.name : "Specialties"}</h1>
        </div>
        {current ? (
          <Button variant="secondary" size="sm" onClick={() => setSelectedSpecialty(null)}>
            All specialties
          </Button>
        ) : null}
      </div>

      {activeCall && activeCall.status === "ringing" && (
        <div className="glass-card flex animate-pulse items-center justify-between gap-4 border-l-4 border-l-primary p-4">
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
      ) : !current ? (
        <ul className="flex flex-col gap-3">
          {bySpecialty.map((sp) => {
            const Icon = SPECIALTY_ICONS[sp.name] ?? Stethoscope;
            const availableCount = sp.doctors.filter((d) => d.is_online && !d.in_consult).length;
            return (
              <li key={sp.name}>
                <button
                  type="button"
                  onClick={() => setSelectedSpecialty(sp.name)}
                  className={`glass-card group flex w-full items-center gap-5 p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 border-l-4 ${
                    availableCount ? "border-l-success/50" : "border-l-muted/50"
                  }`}
                >
                  <div
                    className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary transition group-hover:scale-105 ${
                      availableCount ? "" : "opacity-60 grayscale"
                    }`}
                  >
                    <Icon className="size-7" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{sp.name}</p>
                    <p className="text-sm text-muted-foreground">{sp.doctors.length} physicians on service</p>
                    <p
                      className={`mt-1 text-[0.68rem] font-semibold uppercase tracking-widest ${
                        availableCount ? "text-success" : "text-muted-foreground"
                      }`}
                    >
                      {availableCount ? `${availableCount} available now` : "None available"}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : current.doctors.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          No physicians on service for {current.name} right now.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {current.doctors.map((d) => {
            const status = statusFor(d);
            const isMock = d.id.startsWith("mock:");
            const initials = d.full_name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("");
            return (
              <li key={d.id} className="glass-card flex w-full items-center gap-4 p-4">
                <div className="relative shrink-0">
                  <div className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
                    {initials}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card ${
                      d.in_consult ? "bg-warning" : d.is_online ? "bg-success" : "bg-muted-foreground"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold">
                    {isMock ? "" : "Dr. "}
                    {d.full_name}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{d.specialty ?? current.name}</p>
                  <div
                    className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                      status.color === "success"
                        ? "border-success/20 bg-success/10 text-success"
                        : status.color === "warning"
                          ? "border-warning/20 bg-warning/10 text-warning"
                          : "border-muted bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    <status.icon className="size-3.5" />
                    {status.label}
                  </div>
                </div>
                {isMock ? (
                  <Badge variant="outline" className="shrink-0 text-muted-foreground">
                    Demo
                  </Badge>
                ) : (
                  <Button
                    onClick={() => {
                      if (d.in_consult) {
                        toast.warning(`Dr. ${d.full_name} is in a consult \u2014 please hold.`);
                        return;
                      }
                      setTarget(d);
                    }}
                    disabled={!d.is_online || !!activeCall}
                    className="gap-2"
                  >
                    <PhoneCall className="size-4" /> Call
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ready to round</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Confirm where the cart will be staged. The physician is notified immediately.
            </p>
            <div>
              <Label htmlFor="round-room">Patient room</Label>
              <Input id="round-room" value={roundRoom} onChange={(e) => setRoundRoom(e.target.value)} />
            </div>
            <Button className="w-full gap-2" onClick={acknowledgeRounding}>
              <CheckCircle2 className="size-4" /> Cart is ready
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
