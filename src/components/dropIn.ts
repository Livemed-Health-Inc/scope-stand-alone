export const DROP_IN_SECONDS = 10;

/** Seconds left before a drop-in connects automatically. */
export function dropInRemaining(startedAtMs: number, nowMs: number, total = DROP_IN_SECONDS) {
  return Math.max(0, total - Math.floor((nowMs - startedAtMs) / 1000));
}
