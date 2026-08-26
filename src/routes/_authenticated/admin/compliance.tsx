import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { auditLog } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/admin/compliance")({
  head: () => ({
    meta: [
      { title: "Compliance & Audit Trail — Virtualis Admin" },
      {
        name: "description",
        content:
          "Review the tamper-evident activity log, patient-data access events, and emergency break-glass sessions across the Virtualis platform.",
      },
      { property: "og:title", content: "Compliance & Audit Trail — Virtualis Admin" },
      {
        property: "og:description",
        content: "Tamper-evident activity log, PHI access review, and emergency access tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CompliancePage,
});

type AuditRow = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  actor_kind: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  phi_accessed: boolean;
  outcome: string;
  details: Record<string, unknown> | null;
};

type BreakGlassRow = {
  id: string;
  user_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
};

const WINDOWS = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

function CompliancePage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [breakGlass, setBreakGlass] = useState<BreakGlassRow[]>([]);
  const [actor, setActor] = useState("");
  const [phiOnly, setPhiOnly] = useState(false);
  const [hours, setHours] = useState(24 * 7);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const args: Record<string, unknown> = { _since: since, _phi_only: phiOnly, _limit: 300 };
    if (actor.trim()) args["_actor"] = actor.trim();

    const [{ data, error }, { data: bg }] = await Promise.all([
      supabase.rpc("audit_trail", args as never),
      supabase
        .from("break_glass_events")
        .select("id, user_id, reason, started_at, expires_at, ended_at")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);

    if (error) toast.error(error.message);
    setRows((data as AuditRow[] | null) ?? []);
    setBreakGlass((bg as BreakGlassRow[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [hours, phiOnly]);

  const phiCount = useMemo(() => rows.filter((r) => r.phi_accessed).length, [rows]);

  async function startBreakGlass() {
    const { error } = await supabase.rpc("start_break_glass", { _reason: reason });
    if (error) {
      toast.error(error.message);
      return;
    }
    setReason("");
    toast.success("Emergency access opened and recorded for 60 minutes.");
    void load();
  }

  return (
    <>
      <div>
        <p className="label-caps">HIPAA safeguards</p>
        <h1 className="text-2xl font-semibold tracking-tight">Compliance &amp; audit trail</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every sign-in, permission change, device activation and consult is recorded here. Entries can never be edited
          or deleted — not even by a super admin.
        </p>
      </div>

      <section className="panel-surface space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="actor">Filter by person</Label>
            <Input
              id="actor"
              placeholder="name@hospital.org"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
            />
          </div>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w.hours}
                size="sm"
                variant={hours === w.hours ? "secondary" : "ghost"}
                onClick={() => setHours(w.hours)}
              >
                {w.label}
              </Button>
            ))}
          </div>
          <Button size="sm" variant={phiOnly ? "secondary" : "ghost"} onClick={() => setPhiOnly((v) => !v)}>
            Patient-data events only
          </Button>
          <Button size="sm" className="gap-2" onClick={() => void load()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{rows.length} events</span>
          <span>{phiCount} involving patient data</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Record</th>
                <th className="py-2 pr-4 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap py-2 pr-4 text-xs text-muted-foreground">
                    {new Date(r.occurred_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{r.actor_email ?? r.actor_kind}</td>
                  <td className="py-2 pr-4">
                    <span className="font-medium">{r.action}</span>
                    {r.phi_accessed && (
                      <Badge variant="secondary" className="ml-2 uppercase tracking-widest">
                        PHI
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {r.entity ?? "—"}
                    {r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}
                  </td>
                  <td className="py-2 pr-4 text-xs">{r.outcome}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-sm text-muted-foreground">
                    No activity in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-surface space-y-3 p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-destructive" />
          <h2 className="text-lg font-semibold">Emergency (break-glass) access</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Use only when patient safety requires access you would not normally have. Access lasts 60 minutes, is flagged
          for review, and the reason you enter is permanently recorded.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <Label htmlFor="reason">Written justification</Label>
            <Input
              id="reason"
              placeholder="Code blue at Mercy General — attending unreachable"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button variant="destructive" disabled={reason.trim().length < 10} onClick={() => void startBreakGlass()}>
            Open emergency access
          </Button>
        </div>

        <ul className="divide-y divide-border">
          {breakGlass.map((b) => {
            const active = !b.ended_at && new Date(b.expires_at) > new Date();
            return (
              <li key={b.id} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm">{b.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(b.started_at).toLocaleString()} · expires {new Date(b.expires_at).toLocaleTimeString()}
                  </p>
                </div>
                <Badge variant={active ? "destructive" : "secondary"}>{active ? "Active" : "Closed"}</Badge>
              </li>
            );
          })}
          {breakGlass.length === 0 && (
            <li className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" /> No emergency access has ever been used.
            </li>
          )}
        </ul>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const { error } = await supabase.rpc("end_break_glass");
            if (error) {
              toast.error(error.message);
              return;
            }
            void auditLog({ action: "break_glass.closed_by_admin" });
            void load();
          }}
        >
          Close my emergency access
        </Button>
      </section>
    </>
  );
}
