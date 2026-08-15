import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, Power, PowerOff } from "lucide-react";
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
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

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

  async function issueCode(siteId: string, quiet = false) {
    const { data, error } = await supabase.rpc("create_enrollment_code", { _site_id: siteId });
    if (error || !data) {
      toast.error(error?.message ?? "Could not generate an activation code");
      return null;
    }
    setCodes((c) => ({ ...c, [siteId]: data as string }));
    if (!quiet) toast.success("Activation code generated");
    return data as string;
  }

  async function addSite(withCode: boolean) {
    if (!hospital.trim() || !unit.trim()) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("hospital_sites")
      .insert({ hospital: hospital.trim(), unit: unit.trim() })
      .select("id, hospital, unit, is_active")
      .single();
    if (error || !data) {
      setBusy(false);
      toast.error(error?.message ?? "Could not add unit");
      return;
    }
    setUnit("");
    await load();
    if (withCode) {
      const code = await issueCode((data as Site).id, true);
      if (code) toast.success(`Unit added — activation code ${code}`);
    } else {
      toast.success("Unit added");
    }
    setBusy(false);
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed — select the code manually");
    }
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
          Add a unit, hand its activation code to the field tech, and deactivate a unit to cut its tablets off instantly.
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
          <Button onClick={() => void addSite(true)} disabled={busy} className="gap-2">
            <Plus className="size-4" /> Add & generate code
          </Button>
          <Button onClick={() => void addSite(false)} disabled={busy} variant="secondary">
            Add only
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Activation codes are single-use and expire in 24 hours. The field tech enters the code once on the bedside
          tablet at <span className="font-mono">/nurse</span>.
        </p>
      </section>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Registered units</h2>
        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sites.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{s.hospital}</p>
                  <p className="text-xs text-muted-foreground">{s.unit}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {codes[s.id] ? (
                    <button
                      type="button"
                      onClick={() => void copy(codes[s.id]!)}
                      className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-sm tracking-widest text-primary"
                      title="Copy activation code"
                    >
                      {codes[s.id]}
                      {copied === codes[s.id] ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </button>
                  ) : null}
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => void issueCode(s.id)}>
                    <KeyRound className="size-4" /> {codes[s.id] ? "New code" : "Activation code"}
                  </Button>
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
