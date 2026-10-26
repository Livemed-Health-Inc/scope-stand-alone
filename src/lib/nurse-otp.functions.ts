import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  attemptAllowed,
  canResend,
  CODE_TTL_MS,
  generateCode,
  isExpired,
  safeEqual,
  SESSION_TTL_MS,
  sha256Hex,
} from "@/lib/nurse/otp-rules";
import { generateSecret, otpauthUri, verifyTotp } from "@/lib/nurse/totp";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function admin(): Promise<Admin> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Public entry points trust nothing but a valid, active device token for the nurse's unit. */
async function deviceAndNurse(db: Admin, deviceToken: string, nurseId: string) {
  const { data: ctx } = await db.rpc("device_context", { _device_token: deviceToken });
  const device = (ctx ?? [])[0] as { device_id: string } | undefined;
  if (!device) throw new Error("This tablet is not registered.");
  const { data: dev } = await db.from("devices").select("site_id").eq("id", device.device_id).single();
  const { data: nurse } = await db
    .from("unit_nurses")
    .select("id, full_name, phone_e164, site_id, is_active, totp_confirmed_at")
    .eq("id", nurseId)
    .maybeSingle();
  if (!nurse || !nurse.is_active || nurse.site_id !== dev?.site_id) throw new Error("Nurse not found on this unit.");
  return { deviceId: device.device_id, nurse };
}

async function audit(db: Admin, action: string, deviceId: string, nurseId: string, outcome = "success", details: Record<string, unknown> = {}) {
  await db.from("audit_log").insert({
    action,
    actor_kind: "device",
    device_id: deviceId,
    entity: "unit_nurses",
    entity_id: nurseId,
    outcome,
    details: details as never,
  });
}

export const sendNurseCode = createServerFn({ method: "POST" })
  .inputValidator((i: { deviceToken: string; nurseId: string }) => {
    if (!i?.deviceToken || !i?.nurseId) throw new Error("Missing details");
    return { deviceToken: String(i.deviceToken), nurseId: String(i.nurseId) };
  })
  .handler(async ({ data }) => {
    const db = await admin();
    const { deviceId, nurse } = await deviceAndNurse(db, data.deviceToken, data.nurseId);
    if (!nurse.phone_e164) return { ok: false as const, error: "No mobile number on file for this nurse." };

    const { data: last } = await db
      .from("nurse_otps")
      .select("sent_at")
      .eq("nurse_id", nurse.id)
      .eq("device_id", deviceId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const now = Date.now();
    if (!canResend(last ? new Date(last.sent_at).getTime() : null, now)) {
      return { ok: false as const, error: "Please wait 30 seconds before requesting another code." };
    }

    const lovableKey = process.env["LOVABLE_API_KEY"];
    const twilioKey = process.env["TWILIO_API_KEY"];
    const from = process.env["TWILIO_FROM_NUMBER"];
    if (!lovableKey || !twilioKey || !from) {
      return { ok: false as const, error: "Text codes aren't set up yet. Use the authenticator app instead." };
    }

    const code = generateCode();
    const res = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: nurse.phone_e164,
        From: from,
        Body: `Virtualis Consult bedside code: ${code}. Expires in 5 minutes. Don't share it.`,
      }),
    });
    if (!res.ok) {
      console.error(`Twilio send failed [${res.status}]: ${await res.text()}`);
      await audit(db, "nurse.code_sent", deviceId, nurse.id, "error");
      return { ok: false as const, error: "Couldn't send the text. Try again or use the authenticator app." };
    }
    await db.from("nurse_otps").insert({
      nurse_id: nurse.id,
      device_id: deviceId,
      code_hash: await sha256Hex(`${nurse.id}:${code}`),
      expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    });
    await audit(db, "nurse.code_sent", deviceId, nurse.id);
    return { ok: true as const };
  });

export const verifyNurseCode = createServerFn({ method: "POST" })
  .inputValidator((i: { deviceToken: string; nurseId: string; code: string; method: "sms" | "totp" }) => {
    if (!i?.deviceToken || !i?.nurseId || !i?.code) throw new Error("Missing details");
    if (i.method !== "sms" && i.method !== "totp") throw new Error("Invalid method");
    return { deviceToken: String(i.deviceToken), nurseId: String(i.nurseId), code: String(i.code).trim(), method: i.method };
  })
  .handler(async ({ data }) => {
    const db = await admin();
    const { deviceId, nurse } = await deviceAndNurse(db, data.deviceToken, data.nurseId);
    const now = Date.now();
    const fail = async (error: string) => {
      await audit(db, "nurse.verify_failed", deviceId, nurse.id, "denied", { method: data.method });
      return { ok: false as const, error };
    };

    // Shared lockout: failed attempts across both methods in the last 5 minutes.
    const since = new Date(now - CODE_TTL_MS).toISOString();
    const { count: recentFails } = await db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "nurse.verify_failed")
      .eq("entity_id", nurse.id)
      .eq("device_id", deviceId)
      .gte("occurred_at", since);

    if (data.method === "sms") {
      const { data: otp } = await db
        .from("nurse_otps")
        .select("id, code_hash, expires_at, attempts, used_at")
        .eq("nurse_id", nurse.id)
        .eq("device_id", deviceId)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!otp || otp.used_at || !otp.code_hash) return fail("Request a new code.");
      if (isExpired(new Date(otp.expires_at).getTime(), now)) return fail("That code expired. Request a new one.");
      if (!attemptAllowed(otp.attempts)) return fail("Too many tries. Request a new code.");
      await db.from("nurse_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
      if (!safeEqual(otp.code_hash, await sha256Hex(`${nurse.id}:${data.code}`))) return fail("Incorrect code.");
      await db.from("nurse_otps").update({ used_at: new Date(now).toISOString() }).eq("id", otp.id);
    } else {
      if (!attemptAllowed(recentFails ?? 0)) return fail("Too many tries. Wait 5 minutes and try again.");
      const { data: t } = await db.from("nurse_totp").select("secret, pending, last_step").eq("nurse_id", nurse.id).maybeSingle();
      if (!t || t.pending) return fail("Authenticator isn't set up for this nurse.");
      const step = await verifyTotp(t.secret, data.code, now, t.last_step ?? null);
      if (step === null) return fail("Incorrect code.");
      await db.from("nurse_totp").update({ last_step: step }).eq("nurse_id", nurse.id);
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const session = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expires = new Date(now + SESSION_TTL_MS).toISOString();
    await db.from("nurse_sessions").insert({
      token_hash: await sha256Hex(session),
      nurse_id: nurse.id,
      device_id: deviceId,
      expires_at: expires,
    });
    await audit(db, "nurse.verified", deviceId, nurse.id, "success", { method: data.method });
    return { ok: true as const, session, fullName: nurse.full_name, expiresAt: expires };
  });

type AuthCtx = { supabase: { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> }; userId: string };

async function requireAdmin(context: unknown) {
  const ctx = context as AuthCtx;
  const { data } = await ctx.supabase.rpc("is_admin", { _user_id: ctx.userId });
  if (!data) throw new Error("LiveMed administrators only");
}

export const startNurseTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { nurseId: string }) => ({ nurseId: String(i?.nurseId ?? "") }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const db = await admin();
    const { data: nurse } = await db.from("unit_nurses").select("id, full_name").eq("id", data.nurseId).single();
    if (!nurse) throw new Error("Nurse not found");
    const secret = generateSecret();
    await db.from("nurse_totp").upsert({ nurse_id: nurse.id, secret, pending: true, last_step: null });
    await db.from("unit_nurses").update({ totp_confirmed_at: null }).eq("id", nurse.id);
    return { uri: otpauthUri(secret, nurse.full_name), secret };
  });

export const confirmNurseTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { nurseId: string; code: string }) => ({ nurseId: String(i?.nurseId ?? ""), code: String(i?.code ?? "").trim() }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const db = await admin();
    const { data: t } = await db.from("nurse_totp").select("secret").eq("nurse_id", data.nurseId).maybeSingle();
    if (!t) return { ok: false, error: "Start setup first." };
    const step = await verifyTotp(t.secret, data.code, Date.now(), null);
    if (step === null) return { ok: false, error: "That code didn't match. Try the next one." };
    await db.from("nurse_totp").update({ pending: false, last_step: step }).eq("nurse_id", data.nurseId);
    await db.from("unit_nurses").update({ totp_confirmed_at: new Date().toISOString() }).eq("id", data.nurseId);
    return { ok: true, error: null };
  });

export const resetNurseTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { nurseId: string }) => ({ nurseId: String(i?.nurseId ?? "") }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const db = await admin();
    await db.from("nurse_totp").delete().eq("nurse_id", data.nurseId);
    await db.from("unit_nurses").update({ totp_confirmed_at: null }).eq("id", data.nurseId);
    return { ok: true };
  });
