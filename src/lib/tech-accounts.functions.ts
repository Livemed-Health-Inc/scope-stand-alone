import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function assertAdmin(context: { supabase: { rpc: (fn: string, args: unknown) => Promise<{ data: unknown }> }; userId: string }) {
  const { data } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
  if (!data) throw new Error("Forbidden");
}

/** Creates (or resets) a field-tech login with a generated password. Admin only. */
export const provisionTechAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; note?: string }) => {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    return { email, note: input.note?.trim() || null };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const password = generatePassword();

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { role: "field_tech" },
    });

    let userId = created?.user?.id ?? null;

    if (createError) {
      const alreadyExists = /already|registered|exists/i.test(createError.message);
      if (!alreadyExists) throw new Error(createError.message);

      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === data.email);
      if (!existing) throw new Error("That account exists but could not be updated");
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (updateError) throw new Error(updateError.message);
      userId = existing.id;
    }

    const { error: allowError } = await supabaseAdmin
      .from("tech_allowlist")
      .upsert({ email: data.email, note: data.note }, { onConflict: "email" });
    if (allowError) throw new Error(allowError.message);

    if (userId) {
      await supabaseAdmin.from("profiles").upsert({ id: userId, full_name: data.email.split("@")[0] ?? "" });
    }

    return { email: data.email, password, reset: Boolean(createError) };
  });
