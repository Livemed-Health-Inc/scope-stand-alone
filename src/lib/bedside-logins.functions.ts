import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = {
  supabase: { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> };
  userId: string;
};

/** Bedside logins are unit inboxes, not people — they never receive mail. */
const BEDSIDE_DOMAIN = "bedside.virtualisconsult.com";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Creates (or re-issues the password for) the bedside sign-in tied to one
 * hospital unit. Admin only. The account holds the `hospital` role and can
 * only ever reach that unit's bedside station.
 */
export const provisionBedsideLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { siteId: string }) => {
    if (!input?.siteId) throw new Error("Missing hospital unit");
    return { siteId: input.siteId };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: isAdmin } = await ctx.supabase.rpc("is_admin", { _user_id: ctx.userId });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: site, error: siteError } = await supabaseAdmin
      .from("hospital_sites")
      .select("id, hospital, unit")
      .eq("id", data.siteId)
      .maybeSingle();
    if (siteError || !site) throw new Error("Hospital unit not found");

    const { data: existingLink } = await supabaseAdmin
      .from("bedside_logins")
      .select("user_id, email")
      .eq("site_id", site.id)
      .maybeSingle();

    const email = existingLink?.email ?? `${slug(site.hospital)}-${slug(site.unit)}@${BEDSIDE_DOMAIN}`;
    const password = generatePassword();

    let userId = existingLink?.user_id ?? null;
    let reset = Boolean(existingLink);

    if (userId) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { persona: "hospital", hospital: site.hospital, unit: site.unit },
      });
      if (createError) {
        if (!/already|registered|exists/i.test(createError.message)) throw new Error(createError.message);
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const found = list?.users.find((u) => u.email?.toLowerCase() === email);
        if (!found) throw new Error("That bedside account exists but could not be updated");
        const { error } = await supabaseAdmin.auth.admin.updateUserById(found.id, { password, email_confirm: true });
        if (error) throw new Error(error.message);
        userId = found.id;
        reset = true;
      } else {
        userId = created?.user?.id ?? null;
      }
    }

    if (!userId) throw new Error("Bedside login could not be created");

    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: `${site.hospital} · ${site.unit}`,
      hospital: site.hospital,
      unit: site.unit,
    });

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "hospital" as never }, { onConflict: "user_id,role" });
    if (roleError) throw new Error(roleError.message);

    const { error: linkError } = await supabaseAdmin
      .from("bedside_logins")
      .upsert({ user_id: userId, site_id: site.id, email }, { onConflict: "user_id" });
    if (linkError) throw new Error(linkError.message);

    return { email, password, reset };
  });

/** Removes the bedside sign-in for a unit. Admin only. */
export const revokeBedsideLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("Missing bedside login");
    return { userId: input.userId };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: isAdmin } = await ctx.supabase.rpc("is_admin", { _user_id: ctx.userId });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("bedside_logins").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
