/* Server-only client for pushing bedside consults into Virtualis Chat threads. */

const DEFAULT_BASE = "https://virtualischat.com";

type Result = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

async function post(path: string, payload: unknown): Promise<Result> {
  const key = process.env["VIRTUALIS_ONCALL_KEY"];
  if (!key) return { ok: false, error: "not_configured" };
  const base = process.env["VIRTUALIS_CHAT_URL"] || DEFAULT_BASE;
  let last = "unreachable";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-virtualis-key": key },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON reply */
      }
      if (res.ok) return { ok: true, body };
      last = typeof body["reason"] === "string" ? (body["reason"] as string) : `http_${res.status}`;
      if (res.status >= 400 && res.status < 500) break; // not retryable
    } catch (e) {
      last = e instanceof Error ? e.message : "network";
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return { ok: false, error: last };
}

export type ConsultPayload = {
  external_id: string;
  physician_email: string;
  physician_name: string;
  facility_name: string;
  unit: string;
  patient: string;
  mrn: string | null;
  room: string | null;
  acuity: string;
  reason: string;
  specialty: string;
  specialties: string[];
  nurse_name: string | null;
  respond_by: string;
  reply_url: string;
};

export function deliverConsult(p: ConsultPayload) {
  return post("/api/public/bedside-consult", p);
}

export function deliverNurseMessage(p: { external_id: string; message_id: string; sender_name: string; body: string }) {
  return post("/api/public/bedside-consult/message", p);
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function keyOk(request: Request) {
  const expected = process.env["VIRTUALIS_ONCALL_KEY"] ?? "";
  const given = request.headers.get("x-virtualis-key") ?? "";
  return expected.length >= 16 && safeEqual(given, expected);
}
