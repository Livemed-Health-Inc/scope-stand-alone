import { createFileRoute } from "@tanstack/react-router";
import { sha256Hex } from "@/lib/sso-hash";

/**
 * Single sign-on exchange — the companion of /api/public/identity.
 *
 * Virtualis Chat / Note / One receive a one-time `sso_code` from the digital
 * front door and POST it here to learn who the signed-in user is. The code is
 * single-use and expires in two minutes, so no long-lived credential ever
 * travels in a URL.
 *
 * POST /api/public/sso   { "code": "<sso_code>" }
 *   -> { user: { id, email }, roles: string[], permissions: string[] }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/sso")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let code = "";
        try {
          const body = (await request.json()) as { code?: string };
          code = typeof body.code === "string" ? body.code.trim() : "";
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        if (!code || code.length < 32) return json({ error: "Missing hand-off code" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const hash = await sha256Hex(code);

        const { data: row } = await supabaseAdmin
          .from("sso_handoffs")
          .select("id, user_id, expires_at, used_at")
          .eq("code_hash", hash)
          .maybeSingle();

        if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
          return json({ error: "Hand-off code is invalid or expired" }, 401);
        }

        // Single use: burn the code before returning anything.
        await supabaseAdmin.from("sso_handoffs").update({ used_at: new Date().toISOString() }).eq("id", row.id);

        const [{ data: user }, { data: roles }, { data: perms }] = await Promise.all([
          supabaseAdmin.auth.admin.getUserById(row.user_id),
          supabaseAdmin.from("user_roles").select("role").eq("user_id", row.user_id),
          supabaseAdmin.rpc("permissions_for", { _user_id: row.user_id }),
        ]);

        return json({
          user: { id: row.user_id, email: user?.user?.email ?? null },
          roles: (roles ?? []).map((r) => r.role as string),
          permissions: ((perms as { permission_key: string }[] | null) ?? []).map((p) => p.permission_key),
        });
      },
    },
  },
});
