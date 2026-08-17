import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = {
  supabase: { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> };
  userId: string;
};

const PERSONAS = [
  "hospital",
  "doctor",
  "patient",
  "tech",
  "analytics",
  "system_admin",
  "super_admin",
] as const;

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function assertCanManage(context: Ctx, persona: string) {
  const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
  if (!isAdmin) throw new Error("Forbidden");
  if (persona === "super_admin") {
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
    if (!isSuper) throw new Error("Only a super admin can manage the super admin persona");
  }
}

function validate(input: { email: string; fullName?: string; persona: string; specialty?: string | undefined }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  if (!(PERSONAS as readonly string[]).includes(input.persona)) throw new Error("Unknown persona");
  if (input.persona === "hospital")
    throw new Error("Hospital access is device-based — activate a bedside device with an enrollment code instead");
  return {
    email,
    persona: input.persona,
    fullName: input.fullName?.trim() || "",
    specialty: input.specialty?.trim() || null,
  };
}

/** Creates (or password-resets) a login and grants it a persona. Admin only. */
export const provisionPersonaAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => {
    await assertCanManage(context as unknown as Ctx, data.persona);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const password = generatePassword();
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { persona: data.persona },
    });

    let userId = created?.user?.id ?? null;
    let reset = false;

    if (createError) {
      if (!/already|registered|exists/i.test(createError.message)) throw new Error(createError.message);
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === data.email);
      if (!existing) throw new Error("That account exists but could not be updated");
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (updateError) throw new Error(updateError.message);
      userId = existing.id;
      reset = true;
    }

    if (!userId) throw new Error("Account could not be created");

    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: data.fullName || (data.email.split("@")[0] ?? ""),
      ...(data.specialty ? { specialty: data.specialty } : {}),
    });

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: data.persona as never }, { onConflict: "user_id,role" });
    if (roleError) throw new Error(roleError.message);

    if (data.persona === "system_admin" || data.persona === "super_admin") {
      await supabaseAdmin.from("admin_allowlist").upsert({ email: data.email, note: "Provisioned in admin console" });
    }
    if (data.persona === "tech") {
      await supabaseAdmin.from("tech_allowlist").upsert({ email: data.email, note: "Provisioned in admin console" });
    }

    return { email: data.email, password, reset, userId };
  });

/** Grants or revokes a persona for an existing login. Admin only. */
export const setPersona = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; persona: string; grant: boolean }) => {
    if (!(PERSONAS as readonly string[]).includes(input.persona)) throw new Error("Unknown persona");
    if (input.persona === "hospital" && input.grant)
      throw new Error("Hospital access is device-based — activate a bedside device with an enrollment code instead");
    if (!input.userId) throw new Error("Missing account");
    return { userId: input.userId, persona: input.persona, grant: Boolean(input.grant) };
  })
  .handler(async ({ data, context }) => {
    await assertCanManage(context as unknown as Ctx, data.persona);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.persona as never }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.persona as never);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
