import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Copy, Plus, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({
    meta: [
      { title: "Registered Devices — Virtualis Consult" },
      {
        name: "description",
        content: "Administer bedside tablets: create hospital units, issue enrollment codes and revoke devices.",
      },
      { property: "og:title", content: "Registered Devices — Virtualis Consult" },
      { property: "og:description", content: "Issue enrollment codes and revoke bedside devices." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DevicesPage,
});

type Site = { id: string; hospital: string; unit: string };
type Device = { id: string; site_id: string; label: string; status: string; last_seen: string | null };
type Code = { id: string; code: string; site_id: string; expires_at: string; used_at: string | null };

function DevicesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [hospital, setHospital] = useState("Virtualis General Hospital");
  const [unit, setUnit] = useState("");

  async function load() {
    const [s, d, c] = await Promise.all([
      supabase.from("hospital_sites").select("id, hospital, unit").order("hospital"),
      supabase.from("devices").select("id, site_id, label, status, last_seen").order("created_at", { ascending: false }),
      supabase
        .from("enrollment_codes")
        .select("id, code, site_id, expires_at, used_at")
        .is("used_at", null)
        .order("created_at", { ascending: false }),
    ]);
    setSites(s.data ?? []);
    setDevices(d.data ?? []);
    setCodes(c.data ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addSite() {
    if (!hospital.trim() || !unit.trim()) return;
    const { error } = await supabase.from("hospital_sites").insert({ hospital: hospital.trim(), unit: unit.trim() });
    if (error) { toast.error(error.message); return; }
    setUnit("");
    void load();
  }

  async function issueCode(siteId: string) {
    const { data, error } = await supabase.rpc("create_enrollment_code", { _site_id: siteId });
    if (error) { toast.error(error.message); return; }
    toast.success(`Enrollment code ${data} — valid for 24 hours`);
    void load();
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("devices").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    void load();
  }

  const siteLabel = (id: string) => {
    const s = sites.find((x) => x.id === id);
    return s ? `${s.hospital} · ${s.unit}` : "—";
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <BrandMark size={26} />
          <Button asChild variant="ghost" size="sm" className="ml-auto gap-2">
            <Link to="/doctor">
              <ArrowLeft className="size-4" /> Waiting room
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <p className="label-caps">Administration</p>
          <h1 className="text-2xl font-semibold tracking-tight">Bedside devices</h1>
        </div>

        <section className="panel-surface space-y-3 p-5">
          <h2 className="font-medium">Hospital units</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="hospital">Hospital</Label>
              <Input id="hospital" value={hospital} onChange={(e) => setHospital(e.target.value)} />
            </div>
            <div className="min-w-[180px] flex-1">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" placeholder="ICU - 4 West" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <Button onClick={addSite} className="gap-2">
              <Plus className="size-4" /> Add unit
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {sites.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium">{s.hospital}</p>
                  <p className="text-xs text-muted-foreground">{s.unit}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => issueCode(s.id)}>
                  Issue enrollment code
                </Button>
              </li>
            ))}
            {sites.length === 0 && <li className="py-3 text-sm text-muted-foreground">No units yet.</li>}
          </ul>
        </section>

        <section className="panel-surface space-y-3 p-5">
          <h2 className="font-medium">Open enrollment codes</h2>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unused codes.</p>
          ) : (
            <ul className="divide-y divide-border">
              {codes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div>
                    <p className="font-mono text-sm font-semibold tracking-widest">{c.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {siteLabel(c.site_id)} · expires {new Date(c.expires_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2"
                    onClick={() => {
                      void navigator.clipboard.writeText(c.code);
                      toast.success("Code copied");
                    }}
                  >
                    <Copy className="size-4" /> Copy
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-surface space-y-3 p-5">
          <h2 className="font-medium">Registered devices</h2>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No devices registered yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {siteLabel(d.site_id)}
                      {d.last_seen ? ` · last seen ${new Date(d.last_seen).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        d.status === "active" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                      }
                    >
                      {d.status}
                    </Badge>
                    {d.status === "active" ? (
                      <Button size="sm" variant="secondary" className="gap-2" onClick={() => setStatus(d.id, "revoked")}>
                        <ShieldOff className="size-4" /> Revoke
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="gap-2" onClick={() => setStatus(d.id, "active")}>
                        <ShieldCheck className="size-4" /> Restore
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
