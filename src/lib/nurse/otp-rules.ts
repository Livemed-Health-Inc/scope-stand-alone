export const CODE_TTL_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 30_000;
export const SESSION_TTL_MS = 12 * 60 * 60_000;

export const isExpired = (expiresAtMs: number, nowMs: number) => nowMs >= expiresAtMs;
/** `attempts` is the number already used before this try. */
export const attemptAllowed = (attempts: number) => attempts < MAX_ATTEMPTS;
export const canResend = (lastSentMs: number | null, nowMs: number) =>
  lastSentMs === null || nowMs - lastSentMs >= RESEND_COOLDOWN_MS;

export function generateCode(): string {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0]! % 1_000_000).padStart(6, "0");
}

export async function sha256Hex(value: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
