import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auditLog } from "@/lib/audit";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "pointerdown", "wheel"] as const;

export type IdleTimeoutProps = {
  /** Minutes of inactivity before the session is locked. */
  idleMinutes?: number;
  /** Seconds of warning before the lock fires. */
  warnSeconds?: number;
  /** What "locking" means for this surface. */
  onTimeout: () => void | Promise<void>;
  label?: string;
};

/**
 * HIPAA automatic-logoff control (§164.312(a)(2)(iii)).
 *
 * Watches for user activity and, after a period of inactivity, warns and then
 * terminates the session so unattended workstations cannot expose PHI.
 */
export function IdleTimeout({
  idleMinutes = 15,
  warnSeconds = 60,
  onTimeout,
  label = "session",
}: IdleTimeoutProps) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const firedRef = useRef(false);

  const reset = useCallback(() => {
    lastActivity.current = Date.now();
    setRemaining(null);
  }, []);

  useEffect(() => {
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, reset, { passive: true });
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, reset);
    };
  }, [reset]);

  useEffect(() => {
    const idleMs = idleMinutes * 60_000;
    const warnMs = warnSeconds * 1_000;

    const tick = window.setInterval(() => {
      // A live consult keeps the session alive: clinicians often watch or
      // listen without touching the screen, and locking would drop the call.
      if (isSessionActive()) {
        lastActivity.current = Date.now();
        setRemaining((r) => (r === null ? r : null));
        return;
      }

      const idleFor = Date.now() - lastActivity.current;


      if (idleFor >= idleMs) {
        if (firedRef.current) return;
        firedRef.current = true;
        void auditLog({ action: "session.auto_logoff", entity: label, details: { idle_minutes: idleMinutes } });
        void onTimeout();
        return;
      }

      if (idleFor >= idleMs - warnMs) {
        setRemaining(Math.ceil((idleMs - idleFor) / 1000));
      } else if (remaining !== null) {
        setRemaining(null);
      }
    }, 1_000);

    return () => window.clearInterval(tick);
  }, [idleMinutes, warnSeconds, onTimeout, label, remaining]);

  if (remaining === null) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(28rem,calc(100%-2rem))]"
    >
      <div className="panel-surface flex items-start gap-3 border-destructive/40 p-4 shadow-lg">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Still there?</p>
          <p className="text-xs text-muted-foreground">
            For patient privacy this {label} locks in {remaining}s of inactivity.
          </p>
        </div>
        <Button size="sm" onClick={reset}>
          Stay signed in
        </Button>
      </div>
    </div>
  );
}
