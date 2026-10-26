import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, MessageSquare, Send, Video, X, XCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AcuityBadge } from "@/components/NewConsult";
import { getDeviceToken, type NurseSession } from "@/lib/device";
import { startAlerting, stopAlerting } from "@/lib/ringtone";
import {
  closeBedsideConsult,
  listBedsideConsults,
  postBedsideMessage,
  startConsultVisit,
  type BedsideConsult,
} from "@/lib/virtualis-consult.functions";

const drName = (n: string | null) => (n ? (/^dr\.?\s/i.test(n) ? n : `Dr. ${n}`) : "the on-call physician");

export function BedsideConsults({
  refreshKey,
  disabled,
  verifyNurse,
  onSignOutNurse,
  onStartVisit,
  onCallDirectly,
}: {
  refreshKey: number;
  disabled?: boolean | undefined;
  verifyNurse?: (() => Promise<NurseSession | null>) | undefined;
  onSignOutNurse?: (() => void) | undefined;
  onStartVisit: (c: BedsideConsult, callId: string, doctorId: string) => void;
  onCallDirectly: (c: BedsideConsult) => void;
}) {
  const list = useServerFn(listBedsideConsults);
  const [items, setItems] = useState<BedsideConsult[]>([]);
  const seen = useRef<Map<string, string>>(new Map());

  async function load() {
    const token = getDeviceToken();
    if (!token) return;
    try {
      const rows = await list({ data: { deviceToken: token } });
      for (const r of rows) {
        const prev = seen.current.get(r.id);
        if (prev && prev !== "available" && r.status === "available") {
          startAlerting(4000);
          toast.success(`${drName(r.physician_name)} is available to see the patient`);
        }
        seen.current.set(r.id, r.status);
      }
      setItems(rows);
    } catch {
      /* keep last state */
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => {
      clearInterval(t);
      stopAlerting();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((c) => (
        <ConsultCard
          key={c.id}
          c={c}
          disabled={disabled}
          verifyNurse={verifyNurse}
          onSignOutNurse={onSignOutNurse}
          reload={load}
          onStartVisit={onStartVisit}
          onCallDirectly={onCallDirectly}
        />
      ))}
    </div>
  );
}

function ConsultCard({
  c,
  disabled,
  verifyNurse,
  onSignOutNurse,
  reload,
  onStartVisit,
  onCallDirectly,
}: {
  c: BedsideConsult;
  disabled?: boolean | undefined;
  verifyNurse?: (() => Promise<NurseSession | null>) | undefined;
  onSignOutNurse?: (() => void) | undefined;
  reload: () => Promise<void>;
  onStartVisit: (c: BedsideConsult, callId: string, doctorId: string) => void;
  onCallDirectly: (c: BedsideConsult) => void;
}) {
  const post = useServerFn(postBedsideMessage);
  const start = useServerFn(startConsultVisit);
  const close = useServerFn(closeBedsideConsult);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const doc = drName(c.physician_name);

  const tone =
    c.status === "available"
      ? "border-l-success ring-1 ring-success/30"
      : c.status === "sent"
        ? "border-l-primary"
        : "border-l-warning";

  async function reply() {
    const body = text.trim();
    const token = getDeviceToken();
    if (!body || !token) return;
    const s = verifyNurse ? await verifyNurse() : null;
    if (!s) return;
    setBusy(true);
    try {
      const r = await post({ data: { deviceToken: token, nurseSession: s.session, consultId: c.id, body } });
      setText("");
      if (!r.delivered) toast.warning("Saved here, but Virtualis Chat didn't receive it yet.");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the message.");
    } finally {
      setBusy(false);
      onSignOutNurse?.();
    }
  }

  async function startVisit() {
    const token = getDeviceToken();
    if (!token) return;
    setBusy(true);
    try {
      const r = await start({ data: { deviceToken: token, consultId: c.id } });
      onStartVisit(c, r.callId, r.doctorId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the video visit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`glass-card border-l-4 p-4 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="label-caps">{c.specialty} consult</p>
        <AcuityBadge level={c.acuity} />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={async () => {
            const token = getDeviceToken();
            if (token) await close({ data: { deviceToken: token, consultId: c.id } });
            await reload();
          }}
        >
          <X className="size-4" /> Close
        </Button>
      </div>
      <p className="mt-1 text-lg font-semibold">
        {c.patient_name}
        {c.room ? ` · Room ${c.room}` : ""}
        {c.mrn ? ` · MRN ${c.mrn}` : ""}
      </p>
      <p className="text-sm text-muted-foreground">{c.reason}</p>

      <div className="mt-3 flex items-center gap-2 text-sm font-medium">
        {c.status === "sent" && (
          <>
            <Loader2 className="size-4 animate-spin text-primary" /> Consult sent to {doc} · Waiting for the doctor
          </>
        )}
        {c.status === "available" && (
          <>
            <CheckCircle2 className="size-4 text-success" /> {doc} is available to see the patient
          </>
        )}
        {c.status === "declined" && (
          <>
            <XCircle className="size-4 text-warning" /> {doc} can't take this consult
          </>
        )}
        {c.status === "expired" && (
          <>
            <Clock className="size-4 text-warning" /> No answer from {doc} in time
          </>
        )}
        {c.status === "undelivered" && (
          <>
            <XCircle className="size-4 text-warning" />
            {c.physician_name ? `Not delivered to Virtualis Chat · Call ${doc} directly` : "No on-call physician found for this specialty"}
          </>
        )}
      </div>

      {c.messages.length > 0 && (
        <ul className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          {c.messages.map((m) => (
            <li key={m.id} className={`text-sm ${m.sender === "nurse" ? "text-right" : ""}`}>
              <span className="text-xs text-muted-foreground">{m.sender_name}</span>
              <p className={`inline-block max-w-full rounded-lg px-3 py-1.5 ${m.sender === "nurse" ? "bg-primary text-primary-foreground" : "bg-panel"}`}>
                {m.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {c.status !== "undelivered" && (
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <MessageSquare className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void reply()}
              placeholder={`Message ${doc} in Virtualis Chat…`}
              className="pl-9"
            />
          </div>
          <Button variant="secondary" disabled={!text.trim() || busy} onClick={() => void reply()} aria-label="Send message">
            <Send className="size-4" />
          </Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {(c.status === "available" || (c.status === "undelivered" && c.physician_id)) && (
          <Button size="lg" className="gap-2" disabled={busy || disabled} onClick={() => void startVisit()}>
            <Video className="size-5" /> Start video visit
          </Button>
        )}
        {(c.status === "declined" || c.status === "expired" || (c.status === "undelivered" && !c.physician_id)) && (
          <Button variant="secondary" disabled={disabled} onClick={() => onCallDirectly(c)}>
            Call another physician
          </Button>
        )}
      </div>
    </div>
  );
}
