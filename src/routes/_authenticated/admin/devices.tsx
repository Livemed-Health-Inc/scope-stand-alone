import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/devices")({
  head: () => ({
    meta: [
      { title: "Device Provisioning — LiveMed Admin" },
      {
        name: "description",
        content: "Issue tablet activation codes for field techs and revoke bedside devices.",
      },
      { property: "og:title", content: "Device Provisioning — LiveMed Admin" },
      { property: "og:description", content: "Issue activation codes and revoke bedside tablets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DevicesPage,
});

type Site = { id: string; hospital: string; unit: string; is_active: boolean };
type Device = { id: string; site_id: string; label: string; status: string; last_seen: string | null };
type Code = { id: string; code: string; site_id: string; expires_at: string };

function DevicesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);

  async function load() {
    const [s, d, c] = await Promise.all([
      supabase.from("hospital_sites").select("id, hospital, unit, is_active").order("hospital"),
      supabase.from("devices").select("id, site_id, label, status, last_seen").order("created_at", { ascending: false }),
      supabase
        .from("enrollment_codes")
        .select("id, code, site_id, expires_at")
        .is("used_at", null)
        .order("created_at", { ascending: false }),
    ]);
    setSites((s.data as Site[] | null) ?? []);
    setDevices((d.data as Device[] | null) ?? []);
    setCodes((c.data as Code[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function issueCode(siteId: string) {
    const { data, error } = await supabase.rpc("create_enrollment_code", { _site_id: siteId });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Activation code ${data} — valid for 24 hours`);
    void load();
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("devices").update({ status }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  }

  const siteLabel = (id: string) => {
    const s = sites.find((x) => x.id === id);
    return s ? `${s.hospital} · ${s.unit}` : "—";
  };

  return (
    <>
      <div>
        <p className="label-caps">Provisioning</p>
        <h1 className="text-2xl font-semibold tracking-tight">Bedside tablets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue an activation code for a unit and hand it to the field tech — they activate the tablet during
          installation.
        </p>
      </div>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Issue an activation code</h2>
        <ul className="divide-y divide-border">
          {sites.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <p className="text-sm font-medium">{s.hospital}</p>
                <p className="text-xs text-muted-foreground">
                  {s.unit}
                  {s.is_active ? "" : " · inactive"}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={!s.is_active} onClick={() => issueCode(s.id)}>
                Issue activation code
              </Button>
            </li>
          ))}
          {sites.length === 0 && <li className="py-3 text-sm text-muted-foreground">Add a hospital unit first.</li>}
        </ul>
      </section>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Open activation codes</h2>
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
        <h2 className="font-medium">Registered tablets</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices registered yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium">{d.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {siteLabel(d.site_id)} · last seen {d.last_seen ? new Date(d.last_seen).toLocaleString() : "never"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={d.status === "active" ? "default" : "secondary"}>{d.status}</Badge>
                  {d.status === "active" ? (
                    <Button size="sm" variant="ghost" className="gap-2" onClick={() => setStatus(d.id, "revoked")}>
                      <ShieldOff className="size-4" /> Revoke
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="gap-2" onClick={() => setStatus(d.id, "active")}>
                      <ShieldCheck className="size-4" /> Reactivate
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
