/**
 * Keyword triage rules for the bedside New Consult form — the same fallback
 * Virtualis uses when its trained model is unavailable. Advisory only.
 */
export type Acuity = "critical" | "urgent" | "routine";

export const ACUITY_META: Record<Acuity, { label: string; sla: string; bars: number }> = {
  critical: { label: "Critical", sla: "5 min SLA", bars: 3 },
  urgent: { label: "Urgent", sla: "30 min", bars: 2 },
  routine: { label: "Routine", sla: "4 hr", bars: 1 },
};

export const CONSULT_SPECIALTIES = [
  "Cardiology",
  "Pulmonology",
  "Neurology",
  "Infectious Disease",
  "Nephrology",
  "Critical Care",
  "Hospitalist",
] as const;

const ACUITY_RULES: { level: Acuity; terms: string[] }[] = [
  {
    level: "critical",
    terms: ["chest pain", "stemi", "code", "unresponsive", "stroke", "seizure", "cardiac arrest", "sepsis", "hypotension", "desat", "respiratory distress", "anaphylaxis"],
  },
  {
    level: "urgent",
    terms: ["shortness of breath", "sob", "o2", "oxygen", "fever", "arrhythmia", "afib", "confusion", "aki", "creatinine", "tachycardia", "bleeding", "pain"],
  },
  { level: "routine", terms: ["follow up", "follow-up", "med review", "medication review", "routine", "chronic", "clearance"] },
];

export function suggestAcuity(text: string): Acuity | null {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  for (const r of ACUITY_RULES) if (r.terms.some((k) => t.includes(k))) return r.level;
  return null;
}

const SPECIALTY_RULES: { specialty: (typeof CONSULT_SPECIALTIES)[number]; terms: [string, string][] }[] = [
  {
    specialty: "Cardiology",
    terms: [["chest pain", "chest pain"], ["stemi", "STEMI"], ["arrhythmia", "arrhythmia"], ["afib", "atrial fibrillation"], ["murmur", "murmur"], ["troponin", "troponin"], ["palpitation", "palpitations"], ["heart", "cardiac symptoms"]],
  },
  {
    specialty: "Pulmonology",
    terms: [["o2", "rising O2 need"], ["oxygen", "rising O2 need"], ["shortness of breath", "dyspnea"], ["sob", "dyspnea"], ["wheez", "wheezing"], ["copd", "COPD"], ["asthma", "asthma"], ["desat", "desaturation"], ["cough", "cough"]],
  },
  {
    specialty: "Neurology",
    terms: [["seizure", "seizure"], ["stroke", "stroke signs"], ["weakness", "focal weakness"], ["confusion", "altered mental status"], ["headache", "headache"], ["numb", "numbness"], ["slurred", "slurred speech"]],
  },
  {
    specialty: "Infectious Disease",
    terms: [["sepsis", "sepsis"], ["fever", "fever"], ["infection", "infection"], ["cellulitis", "cellulitis"], ["antibiotic", "antibiotic question"], ["wbc", "elevated WBC"]],
  },
  {
    specialty: "Nephrology",
    terms: [["aki", "acute kidney injury"], ["creatinine", "rising creatinine"], ["dialysis", "dialysis"], ["kidney", "renal concern"], ["potassium", "electrolytes"], ["urine output", "low urine output"]],
  },
  {
    specialty: "Critical Care",
    terms: [["hypotension", "hypotension"], ["unresponsive", "unresponsive"], ["respiratory distress", "respiratory distress"], ["intubat", "airway"], ["pressor", "pressor need"], ["code", "code event"]],
  },
  {
    specialty: "Hospitalist",
    terms: [["admission", "admission"], ["med review", "medication review"], ["medication review", "medication review"], ["discharge", "discharge planning"], ["follow up", "follow-up"]],
  },
];

export type SpecialtySuggestion = { rank: number; specialty: string; basis: string[] };

export function suggestSpecialties(text: string, max = 3): SpecialtySuggestion[] {
  const t = text.toLowerCase();
  if (!t.trim()) return [];
  return SPECIALTY_RULES.map((r, order) => {
    const basis = [...new Set(r.terms.filter(([k]) => t.includes(k)).map(([, label]) => label))];
    const first = Math.min(...r.terms.filter(([k]) => t.includes(k)).map(([k]) => t.indexOf(k)));
    return { specialty: r.specialty, basis, first, order };
  })
    .filter((s) => s.basis.length > 0)
    .sort((a, b) => b.basis.length - a.basis.length || a.first - b.first || a.order - b.order)
    .slice(0, max)
    .map((s, i) => ({ rank: i + 1, specialty: s.specialty, basis: s.basis }));
}
