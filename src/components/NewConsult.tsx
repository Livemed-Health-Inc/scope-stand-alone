import { useMemo, useState } from "react";
import { ArrowLeft, Search, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ACUITY_META,
  CONSULT_SPECIALTIES,
  suggestAcuity,
  suggestSpecialties,
  type Acuity,
} from "@/lib/consult/triage";

export type ConsultDraft = {
  patient: string;
  room: string;
  mrn: string;
  reason: string;
  acuity: Acuity;
  specialties: string[];
};

export type KnownPatient = { name: string; mrn: string; room: string };

const ACUITY_TONE: Record<Acuity, string> = {
  critical: "text-destructive border-destructive bg-destructive/10",
  urgent: "text-warning border-warning bg-warning/10",
  routine: "text-success border-success bg-success/10",
};

export function AcuityGlyph({ level, className = "" }: { level: Acuity; className?: string }) {
  const bars = ACUITY_META[level].bars;
  return (
    <span className={`inline-flex items-end gap-0.5 ${className}`} aria-hidden>
      {[1, 2, 3].map((b) => (
        <span key={b} className={`w-1.5 rounded-sm ${b <= bars ? "bg-current" : "bg-current opacity-20"}`} style={{ height: 4 + b * 4 }} />
      ))}
    </span>
  );
}

export function AcuityBadge({ level }: { level: Acuity }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${ACUITY_TONE[level]}`}>
      <AcuityGlyph level={level} /> {ACUITY_META[level].label}
    </span>
  );
}

export function NewConsult({
  hospital,
  unit,
  knownPatients,
  onBack,
  onSend,
}: {
  hospital: string;
  unit: string;
  knownPatients: KnownPatient[];
  onBack: () => void;
  onSend: (c: ConsultDraft) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(knownPatients.length ? "existing" : "new");
  const [patient, setPatient] = useState("");
  const [room, setRoom] = useState("");
  const [mrn, setMrn] = useState("");
  const [reason, setReason] = useState("");
  const [acuity, setAcuity] = useState<Acuity | null>(null);
  const [spec, setSpec] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const suggestedAcuity = suggestAcuity(reason);
  const candidates = useMemo(() => suggestSpecialties(reason), [reason]);
  const pq = patient.trim().toLowerCase();
  const matches = knownPatients
    .filter((p) => !pq || `${p.name} ${p.mrn} ${p.room}`.toLowerCase().includes(pq))
    .slice(0, 6);
  const specs = CONSULT_SPECIALTIES.filter((s) => s.toLowerCase().includes(query.toLowerCase()));
  const ready = patient.trim() && reason.trim() && acuity && spec.length > 0;
  const add = (s: string) => setSpec((v) => (v.includes(s) ? v : [...v, s]));

  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">New Consult</h1>
      </div>

      <section className="glass-card border-l-4 border-l-primary p-4">
        <p className="label-caps">Sending facility</p>
        <p className="mt-1 text-lg font-semibold">{hospital}</p>
        <p className="text-sm text-muted-foreground">{unit} · this bedside tablet</p>
      </section>

      <section className="glass-card space-y-3 p-4">
        <p className="flex items-center gap-2 text-base font-semibold">
          <User className="size-4 text-primary" /> Patient information
        </p>
        <div className="flex rounded-lg bg-muted p-1">
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === m ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"
              }`}
            >
              {m === "existing" ? "Existing Patient" : "New Patient"}
            </button>
          ))}
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="nc-patient">
            {mode === "existing" ? "Search patient *" : "Patient name *"}
          </label>
          <Input
            id="nc-patient"
            value={patient}
            onChange={(e) => setPatient(e.target.value)}
            placeholder={mode === "existing" ? "Search by name or MRN…" : "Full name"}
            className="mt-1"
          />
          {mode === "existing" && (
            <div className="mt-2">
              {matches.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No matching patient from this tablet's earlier consults. Use New Patient to enter one — there is no
                  external record lookup.
                </p>
              ) : (
                <div className="grid gap-1.5">
                  {matches.map((p) => (
                    <button
                      key={p.name + p.mrn}
                      type="button"
                      onClick={() => {
                        setPatient(p.name);
                        setMrn(p.mrn);
                        setRoom(p.room);
                      }}
                      className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-sm hover:border-primary/40"
                    >
                      <b>{p.name}</b>
                      <span className="text-muted-foreground">
                        {p.mrn ? ` · ${p.mrn}` : ""}
                        {p.room ? ` · Room ${p.room}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="nc-room">Room</label>
            <Input id="nc-room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="412-B" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="nc-mrn">
              MRN <span className="font-normal text-muted-foreground">optional</span>
            </label>
            <Input id="nc-mrn" value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="Links every consult for this patient" className="mt-1" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="nc-reason">Reason *</label>
          <Textarea
            id="nc-reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe the patient's condition and reason for consultation…"
            className="mt-1"
          />
        </div>
      </section>

      <section className="glass-card space-y-3 p-4">
        <div>
          <p className="text-base font-semibold">Acuity *</p>
          <p className="text-xs text-muted-foreground">Three bars Critical · two Urgent · one Routine.</p>
        </div>
        {suggestedAcuity && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <Sparkles className="size-4 text-primary" />
            <span>
              Suggested: <b>{ACUITY_META[suggestedAcuity].label}</b> · keyword rules, advisory only
            </span>
            {acuity !== suggestedAcuity && (
              <Button size="sm" className="ml-auto h-7" onClick={() => setAcuity(suggestedAcuity)}>
                Apply
              </Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {(["critical", "urgent", "routine"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setAcuity(k)}
              className={`flex flex-col items-center gap-1 rounded-xl border py-3 transition ${
                acuity === k ? ACUITY_TONE[k] : "border-border bg-muted/30 text-muted-foreground"
              }`}
            >
              <AcuityGlyph level={k} />
              <span className="text-sm font-semibold">{ACUITY_META[k].label}</span>
              <span className="text-[0.7rem] opacity-70">{ACUITY_META[k].sla}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="glass-card space-y-3 p-4">
        <div>
          <p className="text-base font-semibold">Specialists *</p>
          <p className="text-xs text-muted-foreground">Select one or more. You'll see the on-call physicians next.</p>
        </div>
        {candidates.length > 0 && !dismissed && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span className="text-sm font-semibold">Virtualis routing suggestion</span>
              <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setDismissed(true)}>
                Choose manually
              </Button>
            </div>
            <ol className="mt-2 grid gap-1.5">
              {candidates.map((c) => {
                const added = spec.includes(c.specialty);
                return (
                  <li key={c.specialty} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-muted-foreground">{c.rank}</span>
                    <span>
                      <b>{c.specialty}</b>
                      <span className="text-muted-foreground"> · basis: {c.basis.join(", ")}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="ml-auto h-7"
                      disabled={added}
                      aria-label={`Add ${c.specialty}`}
                      onClick={() => add(c.specialty)}
                    >
                      {added ? "Added" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">Advisory only — nothing is selected until you add it.</p>
          </div>
        )}
        {spec.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {spec.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-3 pr-1 text-sm font-medium text-primary">
                {s}
                <button type="button" aria-label={`Remove ${s}`} onClick={() => setSpec((v) => v.filter((x) => x !== s))} className="rounded-full p-0.5 hover:bg-primary/20">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search specialties…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          {specs.map((s) => {
            const on = spec.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => (on ? setSpec((v) => v.filter((x) => x !== s)) : add(s))}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/30 hover:border-primary/40"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </section>

      <Button
        size="lg"
        className="w-full"
        disabled={!ready}
        onClick={() =>
          acuity && onSend({ patient: patient.trim(), room: room.trim(), mrn: mrn.trim(), reason: reason.trim(), acuity, specialties: spec })
        }
      >
        Send consult
      </Button>
    </div>
  );
}
