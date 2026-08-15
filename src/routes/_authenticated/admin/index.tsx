import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, Clock, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Consult Analytics — LiveMed Admin" },
      {
        name: "description",
        content: "Consult volume and call time by specialty, broken down by day, week, month and year.",
      },
      { property: "og:title", content: "Consult Analytics — LiveMed Admin" },
      { property: "og:description", content: "Consult volume and total call time by specialty." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsPage,
});

type Row = { period: string; specialty: string; consults: number; total_seconds: number };
type Bucket = "day" | "week" | "month" | "year";

const BUCKETS: { key: Bucket; label: string; days: number }[] = [
  { key: "day", label: "Daily", days: 30 },
  { key: "week", label: "Weekly", days: 180 },
  { key: "month", label: "Monthly", days: 730 },
  { key: "year", label: "Yearly", days: 1825 },
];

function hhmm(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function AnalyticsPage() {
  const [bucket, setBucket] = useState<Bucket>("day");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const cfg = BUCKETS.find((b) => b.key === bucket)!;
    const since = new Date(Date.now() - cfg.days * 86400000).toISOString();
    void supabase.rpc("consult_analytics", { _bucket: bucket, _since: since }).then(({ data }) => {
      if (!active) return;
      setRows((data as Row[] | null) ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [bucket]);

  const totals = useMemo(() => {
    const consults = rows.reduce((a, r) => a + Number(r.consults), 0);
    const seconds = rows.reduce((a, r) => a + Number(r.total_seconds), 0);
    return { consults, seconds, avg: consults ? seconds / consults : 0 };
  }, [rows]);

  const bySpecialty = useMemo(() => {
    const m = new Map<string, { consults: number; seconds: number }>();
    for (const r of rows) {
      const cur = m.get(r.specialty) ?? { consults: 0, seconds: 0 };
      m.set(r.specialty, {
        consults: cur.consults + Number(r.consults),
        seconds: cur.seconds + Number(r.total_seconds),
      });
    }
    return [...m.entries()].sort((a, b) => b[1].consults - a[1].consults);
  }, [rows]);

  const byPeriod = useMemo(() => {
    const m = new Map<string, { consults: number; seconds: number }>();
    for (const r of rows) {
      const cur = m.get(r.period) ?? { consults: 0, seconds: 0 };
      m.set(r.period, { consults: cur.consults + Number(r.consults), seconds: cur.seconds + Number(r.total_seconds) });
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const periodLabel = (iso: string) => {
    const d = new Date(iso);
    if (bucket === "year") return String(d.getUTCFullYear());
    if (bucket === "month") return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };

  const maxConsults = Math.max(1, ...byPeriod.map(([, v]) => v.consults));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Analytics</p>
          <h1 className="text-2xl font-semibold tracking-tight">Consult activity</h1>
        </div>
        <div className="flex gap-1">
          {BUCKETS.map((b) => (
            <Button
              key={b.key}
              size="sm"
              variant={bucket === b.key ? "default" : "secondary"}
              onClick={() => setBucket(b.key)}
            >
              {b.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: Activity, label: "Consults", value: String(totals.consults) },
          { icon: Clock, label: "Total call time", value: hhmm(totals.seconds) },
          { icon: Users, label: "Average consult", value: hhmm(totals.avg) },
        ].map((c) => (
          <div key={c.label} className="panel-surface p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <c.icon className="size-4" />
              <span className="label-caps">{c.label}</span>
            </div>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{c.value}</p>
          </div>
        ))}
      </div>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">By specialty</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : bySpecialty.length === 0 ? (
          <p className="text-sm text-muted-foreground">No answered consults in this period yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground">
                <th className="py-2">Specialty</th>
                <th className="py-2 text-right">Consults</th>
                <th className="py-2 text-right">Call time</th>
                <th className="py-2 text-right">Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bySpecialty.map(([spec, v]) => (
                <tr key={spec}>
                  <td className="py-2 font-medium">{spec}</td>
                  <td className="py-2 text-right tabular-nums">{v.consults}</td>
                  <td className="py-2 text-right tabular-nums">{hhmm(v.seconds)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {hhmm(v.consults ? v.seconds / v.consults : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Trend</h2>
        {byPeriod.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to chart yet.</p>
        ) : (
          <ul className="space-y-2">
            {byPeriod.slice(0, 20).map(([period, v]) => (
              <li key={period} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs text-muted-foreground">{periodLabel(period)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(v.consults / maxConsults) * 100}%` }}
                  />
                </div>
                <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                  {v.consults} · {hhmm(v.seconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
