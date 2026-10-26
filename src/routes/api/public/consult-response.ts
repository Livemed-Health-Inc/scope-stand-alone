import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applyResponse, effectiveStatus, type ConsultStatus } from "@/lib/consult/routing";

/**
 * Virtualis Chat -> bedside: the assigned doctor's answer to a consult thread.
 * POST { consult_id, physician_email, response: "available" | "declined" }
 * Header x-virtualis-key (VIRTUALIS_ONCALL_KEY). Returns no patient data.
 */
const schema = z.object({
  consult_id: z.string().uuid(),
  physician_email: z.string().email().max(320),
  response: z.enum(["available", "declined"]),
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/consult-response")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { keyOk } = await import("@/lib/virtualis-chat.server");
        if (!keyOk(request)) return json({ error: "Unauthorized" }, 401);
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid body" }, 400);
        const { consult_id, physician_email, response } = parsed.data;

        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { data: c } = await db.from("bedside_consults").select("id, device_id, status, expires_at, physician_email").eq("id", consult_id).maybeSingle();
        if (!c) return json({ error: "Not found" }, 404);
        if ((c.physician_email ?? "").toLowerCase() !== physician_email.toLowerCase()) return json({ error: "Not the assigned physician" }, 403);
        const next = applyResponse(effectiveStatus(c.status as ConsultStatus, c.expires_at), response);
        if (!next) return json({ ok: false, status: effectiveStatus(c.status as ConsultStatus, c.expires_at) }, 409);
        await db.from("bedside_consults").update({ status: next, responded_at: new Date().toISOString() }).eq("id", c.id);
        await db.from("audit_log").insert({
          action: `consult.physician_${next}`,
          actor_kind: "system",
          actor_email: physician_email,
          device_id: c.device_id,
          entity: "bedside_consults",
          entity_id: c.id,
          outcome: "success",
          details: { source: "virtualis_chat" } as never,
        });
        return json({ ok: true, status: next });
      },
    },
  },
});
