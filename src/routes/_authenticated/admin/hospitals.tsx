import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/hospitals")({
  head: () => ({
    meta: [
      { title: "Hospitals — LiveMed Admin" },
      { name: "description", content: "Add hospital units and activate or deactivate hospital sites." },
      { property: "og:title", content: "Hospitals — LiveMed Admin" },
      { property: "og:description", content: "Activate or deactivate hospital units served by LiveMed." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HospitalsPage,
});

type Site = { id: string; hospital: string; unit: string; is_active: boolean };

function HospitalsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [hospital, setHospital] = useState("");
  const [unit, setUnit] = useState("");

  async function load() {
    const { data } = await supabase
      .from("hospital_sites")
      .select("id, hospital, unit, is_active")
      .order("hospital")
      .order("unit");
    setSites((data as Site[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addSite() {
    if (!hospital.trim() || !unit.trim()) return;
    const { error } = await supabase.from("hospital_sites").insert({ hospital: hospital.trim(), unit: unit.trim() });
    if (error) {
      toast.error(error.message);
      return;
    }
    setUnit("");
    void load();
  }

  async function toggle(site: Site) {
    const { error } = await supabase.from("hospital_sites").update({ is_active: !site.is_active }).eq("id", site.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${site.hospital} · ${site.unit} ${site.is_active ? "deactivated" : "activated"}`);
    void load();
  }

  return (
    <>
      <div>
        <p className="label-caps">Network</p>
        <h1 className="text-2xl font-semibold tracking-tight">Hospitals & units</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deactivating a unit immediately stops its bedside tablets from reaching physicians.
        </p>
      </div>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Add a unit</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="hospital">Hospital</Label>
            <Input
              id="hospital"
              placeholder="Virtualis General Hospital"
              value={hospital}
              onChange={(e) => setHospital(e.target.value)}
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <Label htmlFor="unit">Unit</Label>
            <Input id="unit" placeholder="ICU - 4 West" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <Button onClick={addSite} className="gap-2">
            <Plus className="size-4" /> Add unit
          </Button>
        </div>
      </section>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Registered units</h2>
        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sites.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium">{s.hospital}</p>
                  <p className="text-xs text-muted-foreground">{s.unit}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "active" : "inactive"}</Badge>
                  <Button size="sm" variant="ghost" className="gap-2" onClick={() => toggle(s)}>
                    {s.is_active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                    {s.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
