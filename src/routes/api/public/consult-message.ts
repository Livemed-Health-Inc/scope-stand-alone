import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Virtualis Chat -> bedside: a doctor's message in a bedside consult thread.
 * POST { consult_id, message_id, physician_email, sender_name, body }
 * Header x-virtualis-key. Idempotent on message_id. Returns no patient data.
 */
const schema = z.object({
  consult_id: z.string().uuid(),
  message_id: z.string().min(1).max(100),
  physician_email: z.string().email().max(320),
  sender_name: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const Route = createFileRoute("/api/public/consult-message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { keyOk } = await import("@/lib/virtualis-chat.server");
        if (!keyOk(request)) return json({ error: "Unauthorized" }, 401);
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid body" }, 400);
        const m = parsed.data;

        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { data: c } = await db.from("bedside_consults").select("id, device_id, physician_email").eq("id", m.consult_id).maybeSingle();
        if (!c) return json({ error: "Not found" }, 404);
        if ((c.physician_email ?? "").toLowerCase() !== m.physician_email.toLowerCase()) return json({ error: "Not the assigned physician" }, 403);
        const { error } = await db
          .from("bedside_consult_messages")
          .upsert(
            { consult_id: c.id, sender: "physician", sender_name: m.sender_name, body: m.body, virtualis_message_id: m.message_id },
            { onConflict: "virtualis_message_id", ignoreDuplicates: true },
          );
        if (error) return json({ error: "Could not save" }, 500);
        return json({ ok: true });
      },
    },
  },
});
