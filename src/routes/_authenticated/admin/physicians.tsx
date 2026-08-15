import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/physicians")({
  head: () => ({
    meta: [
      { title: "Physician Assignments — LiveMed Admin" },
      { name: "description", content: "Assign or unassign physicians to the hospital units they cover." },
      { property: "og:title", content: "Physician Assignments — LiveMed Admin" },
      { property: "og:description", content: "Control which physicians appear on each unit's bedside tablet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PhysiciansPage,
});

type Site = { id: string; hospital: string; unit: string; is_active: boolean };
type Doctor = { id: string; full_name: string; specialty: string | null };
type Assignment = { id: string; doctor_id: string; site_id: string; is_active: boolean };

function PhysiciansPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [siteId, setSiteId] = useState<string>("");

  async function load() {
    const [s, r, a] = await Promise.all([
      supabase.from("hospital_sites").select("id, hospital, unit, is_active").order("hospital"),
      supabase.from("user_roles").select("user_id, role").eq("role", "doctor"),
      supabase.from("doctor_assignments").select("id, doctor_id, site_id, is_active"),
    ]);
    const siteRows = (s.data as Site[] | null) ?? [];
    setSites(siteRows);
    setSiteId((cur) => cur || siteRows[0]?.id || "");
    setAssignments((a.data as Assignment[] | null) ?? []);

    const ids = (r.data ?? []).map((x) => x.user_id);
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, specialty").in("id", ids);
      setDoctors((profs as Doctor[] | null) ?? []);
    } else {
      setDoctors([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const assignmentFor = (doctorId: string) => assignments.find((a) => a.doctor_id === doctorId && a.site_id === siteId);

  async function toggle(doctorId: string) {
    if (!siteId) return;
    const existing = assignmentFor(doctorId);
    const { error } = existing
      ? await supabase.from("doctor_assignments").update({ is_active: !existing.is_active }).eq("id", existing.id)
      : await supabase.from("doctor_assignments").insert({ doctor_id: doctorId, site_id: siteId, is_active: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  }

  const site = sites.find((s) => s.id === siteId);

  return (
    <>
      <div>
        <p className="label-caps">Coverage</p>
        <h1 className="text-2xl font-semibold tracking-tight">Physician assignments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assigned physicians are the ones nurses see on that unit's tablet. A unit with no assignments shows every
          physician.
        </p>
      </div>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Unit</h2>
        <div className="flex flex-wrap gap-2">
          {sites.map((s) => (
            <Button key={s.id} size="sm" variant={s.id === siteId ? "default" : "secondary"} onClick={() => setSiteId(s.id)}>
              {s.hospital} · {s.unit}
            </Button>
          ))}
          {sites.length === 0 && <p className="text-sm text-muted-foreground">Add a hospital unit first.</p>}
        </div>
      </section>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">
          Physicians {site ? <span className="text-muted-foreground">— {site.hospital} · {site.unit}</span> : null}
        </h2>
        {doctors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No physician accounts yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {doctors.map((d) => {
              const a = assignmentFor(d.id);
              const on = Boolean(a?.is_active);
              return (
                <li key={d.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{d.full_name || "Unnamed physician"}</p>
                    <p className="text-xs text-muted-foreground">{d.specialty ?? "No specialty on file"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={on ? "default" : "secondary"}>{on ? "assigned" : "unassigned"}</Badge>
                    <Button size="sm" variant="ghost" disabled={!siteId} onClick={() => toggle(d.id)}>
                      {on ? "Unassign" : "Assign"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
