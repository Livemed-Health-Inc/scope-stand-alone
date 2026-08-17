import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, Loader2, Video, HeartPulse } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ensureStaffRecords } from "@/lib/staff";
import { PermissionGate } from "@/components/PermissionGate";
import { VideoVisit } from "@/features/video-visit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/patient")({
  head: () => ({
    meta: [
      { title: "Virtual Visit — Virtualis Consult" },
      {
        name: "description",
        content:
          "Start a direct-to-consumer virtual visit: see which physicians are available and join a live audio-video exam.",
      },
      { property: "og:title", content: "Virtual Visit — Virtualis Consult" },
      { property: "og:description", content: "See available physicians and start a virtual visit in one tap." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PatientPage,
});

type Physician = {
  id: string;
  full_name: string;
  specialty: string | null;
  is_online: boolean;
  in_consult: boolean;
};

function PatientPage() {
  return (
    <PermissionGate permission="patient.visit" title="Virtual visits aren't enabled for this account">
      <PatientPortal />
    </PermissionGate>
  );
}

function PatientPortal() {
  const { user, profile, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [callId, setCallId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [doctorName, setDoctorName] = useState<string>("");

  useEffect(() => {
    if (user) void ensureStaffRecords(user).then(() => refresh());
  }, [user?.id]);

  async function load() {
    const { data, error } = await supabase.rpc("available_physicians");
    if (error) toast.error("Could not load physicians");
    setPhysicians((data ?? []) as Physician[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!callId || status === "in-progress") return;
    const interval = window.setInterval(async () => {
      const { data } = await supabase.from("calls").select("status").eq("id", callId).maybeSingle();
      if (!data) return;
      if (data.status === "in-progress") setStatus("in-progress");
      if (data.status === "ended") {
        setCallId(null);
        setStatus("idle");
      }
    }, 2500);
    return () => window.clearInterval(interval);
  }, [callId, status]);

  async function requestVisit(doctor: Physician) {
    if (!user) return;
    const { data, error } = await supabase
      .from("calls")
      .insert({
        nurse_id: user.id,
        doctor_id: doctor.id,
        status: "ringing",
        patient_room: profile?.full_name ?? "Patient",
        reason: reason || "Virtual visit request",
        hospital: "Virtualis Direct",
        unit: "Consumer telehealth",
      })
      .select("id")
      .maybeSingle();
    if (error || !data) {
      toast.error(error?.message ?? "Could not start the visit");
      return;
    }
    setDoctorName(doctor.full_name);
    setCallId(data.id);
    setStatus("ringing");
    toast.success(`Requesting Dr. ${doctor.full_name}…`);
  }

  async function cancel() {
    if (callId) await supabase.from("calls").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", callId);
    setCallId(null);
    setStatus("idle");
  }

  if (callId && status === "in-progress") {
    return (
      <VideoVisit
        key={callId}
        roomId={callId}
        role="local"
        patient={profile?.full_name ?? "Patient"}
        hospital="Virtualis Direct"
        unit="Consumer telehealth"
        callerName={doctorName}
        title="Virtual visit"
        onEnd={() => void cancel()}
      />
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <BrandMark size={26} />
          <Badge variant="secondary" className="uppercase tracking-widest">
            Virtual visit
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            className="ml-auto"
            onClick={async () => {
              await signOut();
              void navigate({ to: "/auth", replace: true });
            }}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <section className="panel-surface space-y-3 p-5">
          <h1 className="text-xl font-semibold">Start a visit</h1>
          <p className="text-sm text-muted-foreground">
            Choose an available physician. They&apos;ll accept and you&apos;ll drop straight into the exam room.
          </p>
          <div>
            <Label htmlFor="reason">What&apos;s going on?</Label>
            <Input
              id="reason"
              placeholder="Cough and fever for 3 days"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </section>

        {callId ? (
          <section className="panel-surface flex items-center gap-3 p-5">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Waiting for Dr. {doctorName} to accept…</p>
              <p className="text-xs text-muted-foreground">You&apos;ll join the exam room automatically.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void cancel()}>
              Cancel
            </Button>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Physicians</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : physicians.length === 0 ? (
            <p className="text-sm text-muted-foreground">No physicians have joined yet. Please check back shortly.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {physicians.map((d) => (
                <div key={d.id} className="panel-surface flex flex-wrap items-center gap-3 p-4">
                  <HeartPulse className="size-5 text-primary" />
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">Dr. {d.full_name}</p>
                    <p className="text-xs text-muted-foreground">{d.specialty ?? "General medicine"}</p>
                  </div>
                  <Badge variant={d.is_online ? "default" : "secondary"}>
                    {d.in_consult ? "In consult" : d.is_online ? "Available" : "Offline"}
                  </Badge>
                  <Button size="sm" disabled={!d.is_online || d.in_consult || Boolean(callId)} onClick={() => void requestVisit(d)}>
                    <Video className="size-4" /> Request visit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
