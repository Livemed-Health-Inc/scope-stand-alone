import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Shared identity endpoint — the single authentication source of truth.
 *
 * Other Virtualis products (Chat / One / Note) receive a session from the
 * digital front door (see FeatureNav SSO hand-off) and call this endpoint with
 * that access token to resolve who the user is and which features they may
 * use. No product needs its own user table or its own login screen.
 *
 * GET/POST /api/public/identity   Authorization: Bearer <access_token>
 *   -> { user: { id, email }, roles: string[], permissions: string[] }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

async function resolveIdentity({ request }: { request: Request }) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.split(".").length !== 3) {
    return json({ error: "Missing or malformed bearer token" }, 401);
  }

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return json({ error: "Identity service unavailable" }, 503);

  const supabase = createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      // Opaque sb_publishable_ keys are not JWTs: send them only as `apikey`.
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return json({ error: "Invalid token" }, 401);

  const [{ data: roles }, { data: perms }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.rpc("my_permissions"),
  ]);

  return json({
    user: { id: userId, email: (data.claims as { email?: string }).email ?? null },
    roles: (roles ?? []).map((r) => r.role as string),
    permissions: (perms ?? []).map((p) => p.permission_key as string),
  });
}

export const Route = createFileRoute("/api/public/identity")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      GET: resolveIdentity,
      POST: resolveIdentity,
    },
  },
});
