/**
 * PHI handling helpers.
 *
 * Rule of thumb for this app: identifiers never leave the screen they are
 * needed on. Anything that flows into a log, an error report, an analytics
 * event or the audit trail must go through `scrubPhi` first.
 */

const PATTERNS: { label: string; re: RegExp }[] = [
  { label: "[email]", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { label: "[phone]", re: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g },
  { label: "[ssn]", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: "[mrn]", re: /\b(?:MRN|mrn)[:\s#]*[A-Za-z0-9-]{4,}\b/g },
  { label: "[dob]", re: /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/g },
  { label: "[token]", re: /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

/** Removes anything that looks like an identifier from free text. */
export function scrubPhi(input: string): string {
  return PATTERNS.reduce((text, p) => text.replace(p.re, p.label), input);
}

/** Deep-scrubs an object before it is logged or transmitted. */
export function scrubPhiDeep<T>(value: T): T {
  if (typeof value === "string") return scrubPhi(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubPhiDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrubPhiDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "device_token",
  "authorization",
  "apikey",
  "patient_name",
  "mrn",
  "dob",
  "date_of_birth",
  "ssn",
  "notes",
  "chief_complaint",
]);

/** "Maria Gonzalez" -> "Maria G." — enough to confirm identity at the bedside. */
export function maskName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] ?? "—";
  return `${parts[0]} ${(parts.at(-1) ?? "").charAt(0)}.`;
}

/** Shows only the last four characters of a record number. */
export function maskIdentifier(value: string | null | undefined): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
