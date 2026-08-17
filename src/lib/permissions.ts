/**
 * Persona + feature-permission model.
 *
 * Personas live in the `user_roles` table; the features each persona unlocks
 * live in `role_permissions` and are editable by admins in the admin console.
 */

export type Persona =
  | "hospital"
  | "doctor"
  | "patient"
  | "tech"
  | "analytics"
  | "system_admin"
  | "super_admin"
  | "nurse"
  | "admin";

export type PermissionKey =
  | "nurse.station"
  | "nurse.rounding"
  | "doctor.station"
  | "doctor.consult"
  | "patient.visit"
  | "tech.provision"
  | "analytics.view"
  | "admin.hospitals"
  | "admin.physicians"
  | "admin.techs"
  | "admin.users"
  | "admin.roles";

export const PERSONAS: { value: Persona; label: string; blurb: string; legacy?: boolean }[] = [
  {
    value: "hospital",
    label: "Hospital",
    blurb: "Device-based access — granted when a field tech activates a bedside device with an enrollment code. No login.",
  },
  { value: "doctor", label: "Doctor", blurb: "On-call physician waiting room and consults" },
  { value: "patient", label: "Patient / consumer", blurb: "Direct-to-consumer virtual visits" },
  { value: "tech", label: "Field technician", blurb: "Activates facilities and bedside devices" },
  { value: "analytics", label: "Analytics user", blurb: "Read-only consult analytics" },
  { value: "system_admin", label: "System admin", blurb: "Runs day-to-day platform administration" },
  { value: "super_admin", label: "Super admin", blurb: "Full control, including persona permissions" },
  { value: "nurse", label: "Nurse (legacy)", blurb: "Original nurse login", legacy: true },
  { value: "admin", label: "Admin (legacy)", blurb: "Original LiveMed admin login", legacy: true },
];

export function personaLabel(value: string): string {
  return PERSONAS.find((p) => p.value === value)?.label ?? value;
}

/** Ordered persona homes: the first entry the user has access to wins. */
export const PERSONA_HOMES: { permission: PermissionKey; to: string }[] = [
  { permission: "admin.hospitals", to: "/admin" },
  { permission: "admin.users", to: "/admin" },
  { permission: "admin.roles", to: "/admin" },
  { permission: "analytics.view", to: "/admin" },
  { permission: "tech.provision", to: "/tech" },
  { permission: "doctor.station", to: "/doctor" },
  { permission: "nurse.station", to: "/nurse" },
  { permission: "patient.visit", to: "/patient" },
];

export function homeForPermissions(permissions: string[]): string {
  return PERSONA_HOMES.find((h) => permissions.includes(h.permission))?.to ?? "/no-access";
}
