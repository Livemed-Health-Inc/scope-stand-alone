import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sha256Hex } from "@/lib/sso-hash";

/**
 * Issues a short-lived, one-time single sign-on hand-off code.
 *
 * The digital front door has already authenticated the user, so the embedded
 * Virtualis products (Chat / Note / One) never ask for a second login: they
 * receive this code and exchange it at /api/public/sso for the caller's
 * identity, roles and permissions.
 */
export const createSsoHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { product: string }) => ({ product: String(input.product).slice(0, 60) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString();

    const { error } = await supabaseAdmin.from("sso_handoffs").insert({
      code_hash: await sha256Hex(code),
      user_id: context.userId,
      product: data.product,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    return { code, expiresAt };
  });
