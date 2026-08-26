import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, Clock, Download, Headphones, PhoneMissed, Stethoscope, Timer, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Consult Analytics — LiveMed Admin" },
      {
        name: "description",
        content:
          "Consult volume, answer rate, call time, physician performance and stethoscope auscultation usage by day, week, month and year.",
      },
      { property: "og:title", content: "Consult Analytics — LiveMed Admin" },
      {
        property: "og:description",
        content: "Consults by specialty, doctor and hospital plus stethoscope auscultation usage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsPage,
});

type Row = {
  period: string;
  specialty: string;
  doctor_id: string | null;
  doctor_name: string;
  hospital: string;
  unit: string;
  placed: number;
  answered: number;
  missed: number;
  total_seconds: number;
  wait_seconds: number;
  steth_seconds: number;
  ausc_events: number;
  recordings: number;
};

type SiteRow = { site: string; uses: number; seconds: number };
type Bucket = "day" | "week" | "month" | "year";

const BUCKETS: { key: Bucket; label: string; days: number }[] = [
  { key: "day", label: "Daily", days: 30 },
  { key: "week", label: "Weekly", days: 180 },
  { key: "month", label: "Monthly", days: 730 },
  { key: "year", label: "Yearly", days: 1825 },
];

function hhmm(seconds: number) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type Agg = {
  placed: number;
  answered: number;
  missed: number;
  seconds: number;
  wait: number;
  steth: number;
  ausc: number;
  recordings: number;
};

const EMPTY: Agg = { placed: 0, answered: 0, missed: 0, seconds: 0, wait: 0, steth: 0, ausc: 0, recordings: 0 };

function add(a: Agg, r: Row): Agg {
  return {
    placed: a.placed + Number(r.placed),
    answered: a.answered + Number(r.answered),
    missed: a.missed + Number(r.missed),
    seconds: a.seconds + Number(r.total_seconds),
    wait: a.wait + Number(r.wait_seconds),
    steth: a.steth + Number(r.steth_seconds),
    ausc: a.ausc + Number(r.ausc_events),
    recordings: a.recordings + Number(r.recordings),
  };
}

function csvCell(value: unknown) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Row-level export: every period × specialty × physician × facility bucket. */
function downloadRows(rows: Row[], filename: string) {
  downloadCsv(
    filename,
    [
      "Period",
      "Specialty",
      "Physician",
      "Hospital",
      "Unit",
      "Placed",
      "Answered",
      "Missed",
      "Call seconds",
      "Wait seconds",
      "Auscultation seconds",
      "Auscultation sessions",
      "Recordings",
    ],
    rows.map((r) => [
      r.period,
      r.specialty,
      r.doctor_name,
      r.hospital,
      r.unit,
      r.placed,
      r.answered,
      r.missed,
      r.total_seconds,
      r.wait_seconds,
      r.steth_seconds,
      r.ausc_events,
      r.recordings,
    ]),
  );
}

function downloadBreakdown(title: string, firstHeader: string, rows: [string, Agg][]) {
  downloadCsv(
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    [firstHeader, "Consults", "Answered", "Call seconds", "Avg seconds", "Auscultation seconds", "Recordings"],
    rows.map(([label, v]) => [
      label,
      v.placed,
      v.answered,
      v.seconds,
      v.answered ? Math.round(v.seconds / v.answered) : 0,
      v.steth,
      v.recordings,
    ]),
  );
}

function groupBy(rows: Row[], key: (r: Row) => string) {

  const m = new Map<string, Agg>();
  for (const r of rows) m.set(key(r), add(m.get(key(r)) ?? EMPTY, r));
  return [...m.entries()].sort((a, b) => b[1].placed - a[1].placed);
}

function AnalyticsPage() {
  const [bucket, setBucket] = useState<Bucket>("day");
  const [rows, setRows] = useState<Row[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const cfg = BUCKETS.find((b) => b.key === bucket)!;
    const since = new Date(Date.now() - cfg.days * 86400000).toISOString();
    void Promise.all([
      supabase.rpc("consult_analytics_detail", { _bucket: bucket, _since: since }),
      supabase.rpc("auscultation_breakdown", { _since: since }),
    ]).then(([detail, breakdown]) => {
      if (!active) return;
      setRows((detail.data as Row[] | null) ?? []);
      setSites((breakdown.data as SiteRow[] | null) ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [bucket]);

  const totals = useMemo(() => rows.reduce(add, EMPTY), [rows]);
  const bySpecialty = useMemo(() => groupBy(rows, (r) => r.specialty), [rows]);
  const byDoctor = useMemo(() => groupBy(rows, (r) => r.doctor_name), [rows]);
  const byHospital = useMemo(() => groupBy(rows, (r) => `${r.hospital} · ${r.unit}`), [rows]);
  const byPeriod = useMemo(() => {
    const m = new Map<string, Agg>();
    for (const r of rows) m.set(r.period, add(m.get(r.period) ?? EMPTY, r));
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const periodLabel = (iso: string) => {
    const d = new Date(iso);
    if (bucket === "year") return String(d.getUTCFullYear());
    if (bucket === "month") return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };

  const maxConsults = Math.max(1, ...byPeriod.map(([, v]) => v.placed));
  const maxSite = Math.max(1, ...sites.map((s) => Number(s.uses)));

  const cards = [
    { icon: Activity, label: "Consults placed", value: String(totals.placed) },
    { icon: Users, label: "Answered", value: `${totals.answered} (${pct(totals.answered, totals.placed)})` },
    { icon: PhoneMissed, label: "Unanswered", value: String(totals.missed) },
    { icon: Clock, label: "Total call time", value: hhmm(totals.seconds) },
    { icon: Timer, label: "Avg consult", value: hhmm(totals.answered ? totals.seconds / totals.answered : 0) },
    { icon: Timer, label: "Avg time to answer", value: hhmm(totals.answered ? totals.wait / totals.answered : 0) },
    { icon: Stethoscope, label: "Auscultation time", value: hhmm(totals.steth) },
    { icon: Headphones, label: "Auscultation sessions / clips", value: `${totals.ausc} / ${totals.recordings}` },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Analytics &amp; reports</p>
          <h1 className="text-2xl font-semibold tracking-tight">Consult activity</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1">
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
          <Button
            size="sm"
            variant="outline"
            className="ml-2 gap-2"
            disabled={rows.length === 0}
            onClick={() => downloadRows(rows, `consult-report-${bucket}`)}
          >
            <Download className="size-4" /> Full report (CSV)
          </Button>
        </div>
      </div>


      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="panel-surface p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <c.icon className="size-4" />
              <span className="label-caps">{c.label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{c.value}</p>
          </div>
        ))}
      </div>

      <Breakdown title="By specialty" rows={bySpecialty} loading={loading} firstHeader="Specialty" />
      <Breakdown
        title="By physician"
        rows={byDoctor}
        loading={loading}
        firstHeader="Physician"
        onRowClick={setSelectedDoctor}
      />
      <Breakdown title="By hospital & unit" rows={byHospital} loading={loading} firstHeader="Facility" />

      <section className="panel-surface space-y-3 p-5">
        <h2 className="font-medium">Stethoscope auscultation</h2>
        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No auscultation recorded in this period yet.</p>
        ) : (
          <ul className="space-y-2">
            {sites.map((s) => (
              <li key={s.site} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs font-medium">{s.site}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(Number(s.uses) / maxSite) * 100}%` }}
                  />
                </div>
                <span className="w-28 text-right text-xs tabular-nums text-muted-foreground">
                  {s.uses} uses · {hhmm(Number(s.seconds))}
                </span>
              </li>
            ))}
          </ul>
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
                    style={{ width: `${(v.placed / maxConsults) * 100}%` }}
                  />
                </div>
                <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
                  {v.placed} · {hhmm(v.seconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DoctorDetail
        name={selectedDoctor}
        rows={rows}
        periodLabel={periodLabel}
        onClose={() => setSelectedDoctor(null)}
      />
    </>
  );
}

function DoctorDetail({
  name,
  rows,
  periodLabel,
  onClose,
}: {
  name: string | null;
  rows: Row[];
  periodLabel: (iso: string) => string;
  onClose: () => void;
}) {
  const mine = useMemo(() => (name ? rows.filter((r) => r.doctor_name === name) : []), [rows, name]);
  const totals = useMemo(() => mine.reduce(add, EMPTY), [mine]);
  const specialties = useMemo(() => groupBy(mine, (r) => r.specialty), [mine]);
  const facilities = useMemo(() => groupBy(mine, (r) => `${r.hospital} · ${r.unit}`), [mine]);
  const periods = useMemo(() => {
    const m = new Map<string, Agg>();
    for (const r of mine) m.set(r.period, add(m.get(r.period) ?? EMPTY, r));
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [mine]);

  const stats = [
    { label: "Consults placed", value: String(totals.placed) },
    { label: "Answered", value: `${totals.answered} (${pct(totals.answered, totals.placed)})` },
    { label: "Unanswered", value: String(totals.missed) },
    { label: "Total call time", value: hhmm(totals.seconds) },
    { label: "Avg consult", value: hhmm(totals.answered ? totals.seconds / totals.answered : 0) },
    { label: "Avg time to answer", value: hhmm(totals.answered ? totals.wait / totals.answered : 0) },
    { label: "Auscultation time", value: hhmm(totals.steth) },
    { label: "Auscultation sessions / clips", value: `${totals.ausc} / ${totals.recordings}` },
  ];

  return (
    <Dialog open={!!name} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>Consult performance, facilities and auscultation usage for this period.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border p-3">
              <p className="label-caps text-[10px] text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-base font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>

        <MiniTable title="Specialties" first="Specialty" rows={specialties} />
        <MiniTable title="Facilities" first="Facility" rows={facilities} />
        <MiniTable title="Activity" first="Period" rows={periods.map(([p, v]) => [periodLabel(p), v])} />

        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={mine.length === 0}
            onClick={() => downloadRows(mine, `physician-${(name ?? "report").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)}
          >
            <Download className="size-4" /> Export physician report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MiniTable({ title, first, rows }: { title: string; first: string; rows: [string, Agg][] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground">
              <th className="py-1.5">{first}</th>
              <th className="py-1.5 text-right">Consults</th>
              <th className="py-1.5 text-right">Answered</th>
              <th className="py-1.5 text-right">Call time</th>
              <th className="py-1.5 text-right">Auscultation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(([label, v]) => (
              <tr key={label}>
                <td className="py-1.5 font-medium">{label}</td>
                <td className="py-1.5 text-right tabular-nums">{v.placed}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{v.answered}</td>
                <td className="py-1.5 text-right tabular-nums">{hhmm(v.seconds)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{hhmm(v.steth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "0%";
}

function Breakdown({
  title,
  rows,
  loading,
  firstHeader,
}: {
  title: string;
  rows: [string, Agg][];
  loading: boolean;
  firstHeader: string;
}) {
  return (
    <section className="panel-surface space-y-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        <Button
          size="sm"
          variant="ghost"
          className="gap-2"
          disabled={rows.length === 0}
          onClick={() => downloadBreakdown(title, firstHeader, rows)}
        >
          <Download className="size-4" /> Export
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No consults in this period yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground">
                <th className="py-2">{firstHeader}</th>
                <th className="py-2 text-right">Consults</th>
                <th className="py-2 text-right">Answered</th>
                <th className="py-2 text-right">Call time</th>
                <th className="py-2 text-right">Avg</th>
                <th className="py-2 text-right">Auscultation</th>
                <th className="py-2 text-right">Clips</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(([label, v]) => (
                <tr key={label}>
                  <td className="py-2 font-medium">{label}</td>
                  <td className="py-2 text-right tabular-nums">{v.placed}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {v.answered} · {pct(v.answered, v.placed)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{hhmm(v.seconds)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {hhmm(v.answered ? v.seconds / v.answered : 0)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{hhmm(v.steth)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{v.recordings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
