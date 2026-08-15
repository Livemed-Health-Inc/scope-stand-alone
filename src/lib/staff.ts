import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

/**
 * Creates the profile + role rows for a freshly signed-up staff member.
 * Safe to call on every authenticated load: it no-ops when rows already exist.
 */
export async function ensureStaffRecords(user: User) {
  const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!profile) {
    await supabase.from("profiles").insert({
      id: user.id,
      full_name: meta['full_name'] ?? user.email?.split("@")[0] ?? "Staff Member",
      specialty: meta['specialty'] ?? null,
      hospital: meta['hospital'] ?? "Virtualis General Hospital",
      unit: meta['unit'] ?? "ICU - 4 West",
    });
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  if (!roles || roles.length === 0) {
    const role = meta['staff_role'] === "doctor" ? "doctor" : "nurse";
    await supabase.from("user_roles").insert({ user_id: user.id, role });
    if (role === "doctor") {
      await supabase.from("doctor_presence").insert({ user_id: user.id, is_online: false, in_consult: false });
    }
  }
}

export async function setDoctorPresence(userId: string, patch: { is_online?: boolean; in_consult?: boolean; ready_to_round?: boolean }) {
  const { error } = await supabase
    .from("doctor_presence")
    .upsert({ user_id: userId, last_seen: new Date().toISOString(), ...patch }, { onConflict: "user_id" });
  if (error) throw error;
}
