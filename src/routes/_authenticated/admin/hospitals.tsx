import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Link as LinkIcon,
  MonitorPlay,
  Plus,

  Power,
  PowerOff,
  ShieldCheck,
  ShieldOff,
  Tablet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/hospitals")({
  head: () => ({
    meta: [
      { title: "Hospitals & Devices — LiveMed Admin" },
      {
        name: "description",
        content: "Add hospital units, issue tablet activation codes, and manage bedside devices per unit.",
      },
      { property: "og:title", content: "Hospitals & Devices — LiveMed Admin" },
      {
        property: "og:description",
        content: "Activate hospital units and manage the bedside tablets registered to each one.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HospitalsPage,
});

type Site = { id: string; hospital: string; unit: string; is_active: boolean };
type Device = { id: string; site_id: string; label: string; status: string; last_seen: string | null };
type Code = { id: string; code: string; site_id: string; expires_at: string };

function HospitalsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [hospital, setHospital] = useState("");
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const [s, d, c] = await Promise.all([
      supabase.from("hospital_sites").select("id, hospital, unit, is_active").order("hospital").order("unit"),
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

  async function issueCode(siteId: string, quiet = false) {
    const { data, error } = await supabase.rpc("create_enrollment_code", { _site_id: siteId });
    if (error || !data) {
      toast.error(error?.message ?? "Could not generate an activation code");
      return null;
    }
    setOpen((o) => ({ ...o, [siteId]: true }));
    await load();
    if (!quiet) toast.success(`Activation code ${data} — valid for 24 hours`);
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

  function activationUrl(code: string) {
    return `${window.location.origin}/nurse/activate?code=${encodeURIComponent(code)}`;
  }

  async function openBedside(site: Site) {
    // Open the tab synchronously (no noopener, so we keep the handle) to survive popup blockers.
    const tab = window.open("about:blank", "_blank");
    const { data, error } = await supabase.rpc("admin_preview_device", { _site_id: site.id });
    const row = (data ?? [])[0] as { device_token: string } | undefined;
    if (error || !row) {
      tab?.close();
      toast.error(error?.message ?? "Could not open the bedside view");
      return;
    }
    const url = `${window.location.origin}/nurse?preview=${encodeURIComponent(row.device_token)}`;
    if (tab && !tab.closed) {
      tab.location.replace(url);
    } else {
      // Popup blocked (common inside the preview iframe) — navigate the top-level window instead.
      const target = window.top ?? window;
      target.location.href = url;
    }
    void load();
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

  async function copyUrl(code: string) {
    try {
      await navigator.clipboard.writeText(activationUrl(code));
      setCopied(`${code}-url`);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed — select the link manually");
    }
  }

  function openActivation(code: string) {
    window.open(activationUrl(code), "_blank", "noopener,noreferrer");
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

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("devices").update({ status }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  }

  return (
    <>
      <div>
        <p className="label-caps">Network</p>
        <h1 className="text-2xl font-semibold tracking-tight">Hospitals, units & tablets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a unit, hand its activation code to the field tech, and manage the bedside tablets registered to it.
          Deactivating a unit immediately stops its tablets from reaching physicians.
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
          Activation codes are single-use and expire in 24 hours. The field tech opens{" "}
          <span className="font-mono">/nurse/activate</span> on the bedside tablet and enters the code, or clicks the
          direct activation link from this page.
        </p>
      </section>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Registered units</h2>
        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sites.map((s) => {
              const siteDevices = devices.filter((d) => d.site_id === s.id);
              const siteCodes = codes.filter((c) => c.site_id === s.id);
              const expanded = open[s.id] ?? false;
              return (
                <li key={s.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [s.id]: !expanded }))}
                      className="flex items-center gap-2 text-left"
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                      <span>
                        <span className="block text-sm font-medium">{s.hospital}</span>
                        <span className="block text-xs text-muted-foreground">
                          {s.unit} · {siteDevices.length} tablet{siteDevices.length === 1 ? "" : "s"}
                          {siteCodes.length > 0 ? ` · ${siteCodes.length} open code${siteCodes.length === 1 ? "" : "s"}` : ""}
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        disabled={!s.is_active}
                        title={s.is_active ? "Open the live bedside station for this unit" : "Activate this unit first"}
                        onClick={() => void openBedside(s)}
                      >
                        <MonitorPlay className="size-4" /> Bedside view
                      </Button>
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => void issueCode(s.id)}>
                        <KeyRound className="size-4" /> Activation code
                      </Button>
                      <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "active" : "inactive"}</Badge>
                      <Button size="sm" variant="ghost" className="gap-2" onClick={() => toggle(s)}>
                        {s.is_active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                        {s.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>

                  </div>

                  {expanded && (
                    <div className="mt-3 ml-6 space-y-4 border-l border-border pl-4">
                      <div>
                        <p className="label-caps">Open activation codes</p>
                        {siteCodes.length === 0 ? (
                          <p className="mt-1 text-sm text-muted-foreground">No unused codes.</p>
                        ) : (
                          <ul className="mt-1.5 space-y-1.5">
                            {siteCodes.map((c) => (
                              <li key={c.id} className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void copy(c.code)}
                                  className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-sm tracking-widest text-primary"
                                  title="Copy activation code"
                                >
                                  {c.code}
                                  {copied === c.code ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                                </button>
                                <span className="text-xs text-muted-foreground">
                                  expires {new Date(c.expires_at).toLocaleString()}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1.5 px-2 text-xs"
                                  onClick={() => openActivation(c.code)}
                                >
                                  <ExternalLink className="size-3.5" /> Open screen
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1.5 px-2 text-xs"
                                  onClick={() => void copyUrl(c.code)}
                                >
                                  {copied === `${c.code}-url` ? (
                                    <Check className="size-3.5" />
                                  ) : (
                                    <LinkIcon className="size-3.5" />
                                  )}
                                  Copy link
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <p className="label-caps">Bedside tablets</p>
                        {siteDevices.length === 0 ? (
                          <p className="mt-1 text-sm text-muted-foreground">No tablets activated on this unit yet.</p>
                        ) : (
                          <ul className="mt-1.5 divide-y divide-border">
                            {siteDevices.map((d) => (
                              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                                <div className="flex items-center gap-2">
                                  <Tablet className="size-4 text-muted-foreground" />
                                  <div>
                                    <p className="text-sm font-medium">{d.label}</p>
                                    <p className="text-xs text-muted-foreground">
                                      last seen {d.last_seen ? new Date(d.last_seen).toLocaleString() : "never"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={d.status === "active" ? "default" : "secondary"}>{d.status}</Badge>
                                  {d.status === "active" ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="gap-2"
                                      onClick={() => setStatus(d.id, "revoked")}
                                    >
                                      <ShieldOff className="size-4" /> Revoke
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="gap-2"
                                      onClick={() => setStatus(d.id, "active")}
                                    >
                                      <ShieldCheck className="size-4" /> Reactivate
                                    </Button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
