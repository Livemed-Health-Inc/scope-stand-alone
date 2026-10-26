import type { Acuity } from "@/lib/consult/triage";

/** Bedside specialty buckets; a physician's free-text specialty maps to one. */
export const SPECIALTY_KEYWORDS: { name: string; keywords: string[] }[] = [
  { name: "Cardiology", keywords: ["cardio", "heart"] },
  { name: "Pulmonology", keywords: ["pulmon", "lung", "respir"] },
  { name: "Neurology", keywords: ["neuro"] },
  { name: "Infectious Disease", keywords: ["infect", "id"] },
  { name: "Nephrology", keywords: ["nephro", "renal", "kidney"] },
  { name: "Critical Care", keywords: ["critical", "intensiv", "icu"] },
  { name: "Hospitalist", keywords: ["hospitalist", "internal", "medicine"] },
];

export function specialtyBucket(specialty: string | null | undefined): string {
  const s = (specialty ?? "").toLowerCase();
  return SPECIALTY_KEYWORDS.find((sp) => sp.keywords.some((k) => s.includes(k)))?.name ?? "Hospitalist";
}

/** How long a doctor has to answer a bedside consult before it expires. */
export const RESPONSE_WINDOW_MS: Record<Acuity, number> = {
  critical: 5 * 60 * 1000,
  urgent: 30 * 60 * 1000,
  routine: 4 * 60 * 60 * 1000,
};

export type RosterDoctor = { id: string; specialty: string | null; online: boolean; inConsult: boolean; name: string };

/** Picks the on-call physician for a specialty: available, then in consult, then offline. */
export function pickPhysician(doctors: RosterDoctor[], specialty: string): RosterDoctor | null {
  const rank = (d: RosterDoctor) => (d.online && !d.inConsult ? 0 : d.online ? 1 : 2);
  const list = doctors
    .filter((d) => specialtyBucket(d.specialty) === specialty)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return list[0] ?? null;
}

export type ConsultStatus = "sent" | "available" | "declined" | "expired" | "undelivered" | "called";

/** A video visit may be started only after the doctor said he's available (or delivery failed, as a fallback). */
export function canStartVisit(status: ConsultStatus): boolean {
  return status === "available" || status === "undelivered";
}

/** Status shown at the bedside: a still-"sent" consult past its window counts as expired. */
export function effectiveStatus(status: ConsultStatus, expiresAt: string | Date, now = Date.now()): ConsultStatus {
  return status === "sent" && new Date(expiresAt).getTime() <= now ? "expired" : status;
}

/** Doctor responses accepted from Virtualis, and only while the consult awaits one. */
export function applyResponse(current: ConsultStatus, response: "available" | "declined"): ConsultStatus | null {
  if (current !== "sent") return null;
  return response;
}
