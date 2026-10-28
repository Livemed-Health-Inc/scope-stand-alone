import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { DoctorStation } from "@/components/DoctorStation";
import { EncounterWorkspace } from "@/components/EncounterWorkspace";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/one")({
  head: () => ({ meta: [
    { title: "Virtualis One — LiveMed Physician Workspace" },
    { name: "description", content: "LiveMed physician workspace for bedside consults, native video and stethoscope exams with encounter-context panels." },
    { property: "og:title", content: "Virtualis One — LiveMed Physician Workspace" },
    { property: "og:description", content: "Review bedside referral context alongside Consult video, Chat, Note and patient-history connection states." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: OnePage,
});

function OnePage() {
  const { profile } = useAuth();
  return <PermissionGate permission="platform.one">
    <PermissionGate permission="doctor.station" title="Physician access required">
      <div className="min-h-screen bg-background">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3"><Button variant="ghost" size="icon" asChild aria-label="Back to your workspace"><Link to="/home"><ArrowLeft /></Link></Button><BrandMark iconOnly size={30} /><span className="text-sm font-semibold">LiveMed</span></div>
          <span className="text-sm text-muted-foreground">{profile?.full_name || "Physician"}</span>
        </header>
        <DoctorStation renderWorkspace={(call, station) => <EncounterWorkspace key={call?.id ?? "waiting"} call={call} station={station} />} />
      </div>
    </PermissionGate>
  </PermissionGate>;
}