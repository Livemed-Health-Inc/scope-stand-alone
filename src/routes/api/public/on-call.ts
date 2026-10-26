import { createFileRoute } from "@tanstack/react-router";

/**
 * Live on-call roster for Virtualis Chat (server-to-server only).
 *
 * GET /api/public/on-call
 *   Header: x-virtualis-key: <VIRTUALIS_ONCALL_KEY>
 *   -> { generated_at, physicians: [{ id, name, specialty, status, hospitals: [{hospital, unit}] }] }
 *
 * Returns staff directory data only (no patient data). Callers must hold the
 * shared key; it must never be shipped to a browser.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const Route = createFileRoute("/api/public/on-call")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env["VIRTUALIS_ONCALL_KEY"] ?? "";
        const given = request.headers.get("x-virtualis-key") ?? "";
        if (expected.length < 16 || !safeEqual(given, expected)) {
          return json({ error: "Unauthorized" }, 401);
        }

        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { data: roles, error: rErr } = await db.from("user_roles").select("user_id").eq("role", "doctor");
        if (rErr) return json({ error: rErr.message }, 500);
        const ids = [...new Set((roles ?? []).map((r) => r.user_id))];
        if (!ids.length) return json({ generated_at: new Date().toISOString(), physicians: [] });

        const [profiles, presence, assigns] = await Promise.all([
          db.from("profiles").select("id, full_name, specialty").in("id", ids),
          db.from("doctor_presence").select("user_id, is_online, in_consult, last_seen").in("user_id", ids),
          db
            .from("doctor_assignments")
            .select("doctor_id, hospital_sites(hospital, unit, is_active)")
            .eq("is_active", true)
            .in("doctor_id", ids),
        ]);
        if (profiles.error) return json({ error: profiles.error.message }, 500);

        const pres = new Map((presence.data ?? []).map((p) => [p.user_id, p]));
        const sites = new Map<string, { hospital: string; unit: string }[]>();
        for (const a of (assigns.data ?? []) as Array<{
          doctor_id: string;
          hospital_sites: { hospital: string; unit: string; is_active: boolean } | null;
        }>) {
          const s = a.hospital_sites;
          if (!s || !s.is_active) continue;
          const list = sites.get(a.doctor_id) ?? [];
          list.push({ hospital: s.hospital, unit: s.unit });
          sites.set(a.doctor_id, list);
        }

        const stale = Date.now() - 2 * 60 * 1000;
        const physicians = (profiles.data ?? [])
          .map((p) => {
            const pr = pres.get(p.id);
            const online = !!pr?.is_online && new Date(pr.last_seen).getTime() > stale;
            const status = !online ? "offline" : pr?.in_consult ? "in_consult" : "available";
            return {
              id: p.id,
              name: p.full_name,
              specialty: p.specialty,
              status,
              hospitals: sites.get(p.id) ?? [],
            };
          })
          .sort((a, b) => {
            const rank = { available: 0, in_consult: 1, offline: 2 } as const;
            return rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank] || a.name.localeCompare(b.name);
          });

        return json({ generated_at: new Date().toISOString(), physicians });
      },
    },
  },
});
