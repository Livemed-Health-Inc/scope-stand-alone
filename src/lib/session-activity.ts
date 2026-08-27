/**
 * Tracks "the session is genuinely in use" state for surfaces that must not be
 * auto-locked, even when nobody is touching the screen — most importantly a
 * live consult, where the clinician may be quietly watching or listening.
 */

let holds = 0;
const listeners = new Set<(busy: boolean) => void>();

function emit() {
  const busy = holds > 0;
  for (const listener of listeners) listener(busy);
}

/** Marks the session as actively in use until the returned release is called. */
export function holdSessionActive(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    emit();
  };
}

export function isSessionActive() {
  return holds > 0;
}

export function subscribeSessionActive(listener: (busy: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
