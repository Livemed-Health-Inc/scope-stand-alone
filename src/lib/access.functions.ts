import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> }; userId: string };

async function assertAdmin(context: Ctx) {
  const { data } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
  if (!data) throw new Error("Forbidden");
}

/** Lists every login with its assigned personas. Admin only. */
export const listAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as unknown as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(error.message);

    const [{ data: roles }, { data: profiles }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.from("profiles").select("id, full_name"),
    ]);

    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    const rolesById = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      rolesById.set(r.user_id, [...(rolesById.get(r.user_id) ?? []), r.role as string]);
    });

    return (list?.users ?? [])
      .map((u) => ({
        id: u.id,
        email: u.email ?? "",
        full_name: nameById.get(u.id) ?? "",
        created_at: u.created_at,
        personas: rolesById.get(u.id) ?? [],
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  });
