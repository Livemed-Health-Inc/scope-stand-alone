import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { pickPhysician, RESPONSE_WINDOW_MS, canStartVisit, effectiveStatus, type ConsultStatus } from "@/lib/consult/routing";
import type { Acuity } from "@/lib/consult/triage";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];
const admin = async (): Promise<Admin> => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

const REPLY_URL = "https://virtualisconsult.com/api/public/consult-response";

async function deviceFor(db: Admin, token: string) {
  const { data } = await db.rpc("device_context", { _device_token: token });
  const ctx = (data ?? [])[0] as { device_id: string; hospital: string; unit: string } | undefined;
  if (!ctx) throw new Error("This tablet is not registered.");
  const { data: dev } = await db.from("devices").select("site_id").eq("id", ctx.device_id).single();
  return { ...ctx, site_id: dev!.site_id as string };
}

async function nurseFor(db: Admin, token: string, session: string) {
  const { data } = await db.rpc("nurse_from_session", { _device_token: token, _session: session });
  const n = (data ?? [])[0] as { nurse_id: string; full_name: string } | undefined;
  if (!n) throw new Error("Nurse sign-in expired. Please verify again.");
  return n;
}

async function audit(db: Admin, action: string, deviceId: string, entityId: string | null, outcome: string, details: Record<string, unknown>) {
  await db.from("audit_log").insert({
    action,
    actor_kind: "device",
    device_id: deviceId,
    entity: "bedside_consults",
    entity_id: entityId,
    phi_accessed: true,
    outcome,
    details: details as never,
  });
}

const draftSchema = z.object({
  patient: z.string().trim().min(1).max(200),
  room: z.string().trim().max(40),
  mrn: z.string().trim().max(60),
  reason: z.string().trim().min(1).max(4000),
  acuity: z.enum(["critical", "urgent", "routine"]),
  specialties: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
});

export const submitBedsideConsult = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ deviceToken: z.string().min(8), nurseSession: z.string().min(8), draft: draftSchema }).parse(i),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const dev = await deviceFor(db, data.deviceToken);
    const nurse = await nurseFor(db, data.deviceToken, data.nurseSession);

    // On-call physicians assigned to this unit.
    const { data: asg } = await db.from("doctor_assignments").select("doctor_id").eq("site_id", dev.site_id).eq("is_active", true);
    const ids = [...new Set((asg ?? []).map((a) => a.doctor_id))];
    const [{ data: profs }, { data: pres }] = await Promise.all([
      ids.length ? db.from("profiles").select("id, full_name, specialty").in("id", ids) : Promise.resolve({ data: [] as never[] }),
      ids.length ? db.from("doctor_presence").select("user_id, is_online, in_consult, last_seen").in("user_id", ids) : Promise.resolve({ data: [] as never[] }),
    ]);
    const stale = Date.now() - 2 * 60 * 1000;
    const pm = new Map((pres ?? []).map((p: { user_id: string; is_online: boolean; in_consult: boolean; last_seen: string }) => [p.user_id, p]));
    const roster = (profs ?? []).map((p: { id: string; full_name: string; specialty: string | null }) => {
      const pr = pm.get(p.id);
      const online = !!pr?.is_online && new Date(pr.last_seen).getTime() > stale;
      return { id: p.id, name: p.full_name, specialty: p.specialty, online, inConsult: online && !!pr?.in_consult };
    });

    const d = data.draft;
    const expires = new Date(Date.now() + RESPONSE_WINDOW_MS[d.acuity as Acuity]).toISOString();
    const { deliverConsult } = await import("@/lib/virtualis-chat.server");
    const results: { specialty: string; physician: string | null; status: ConsultStatus }[] = [];

    for (const specialty of [...new Set(d.specialties)]) {
      const doc = pickPhysician(roster, specialty);
      let email: string | null = null;
      if (doc) {
        const { data: u } = await db.auth.admin.getUserById(doc.id);
        email = u?.user?.email ?? null;
      }
      const { data: row, error } = await db
        .from("bedside_consults")
        .insert({
          device_id: dev.device_id,
          site_id: dev.site_id,
          nurse_id: nurse.nurse_id,
          nurse_name: nurse.full_name,
          patient_name: d.patient,
          mrn: d.mrn || null,
          room: d.room || null,
          acuity: d.acuity,
          reason: d.reason,
          specialty,
          specialties: d.specialties,
          physician_id: doc?.id ?? null,
          physician_name: doc?.name ?? null,
          physician_email: email,
          status: "sent",
          expires_at: expires,
        })
        .select("id")
        .single();
      if (error || !row) throw new Error("Could not save the consult.");

      let status: ConsultStatus = "sent";
      let deliveryError: string | null = null;
      let threadId: string | null = null;
      if (!doc || !email) {
        status = "undelivered";
        deliveryError = "no_physician";
      } else {
        const r = await deliverConsult({
          external_id: row.id,
          physician_email: email,
          physician_name: doc.name,
          facility_name: dev.hospital,
          unit: dev.unit,
          patient: d.patient,
          mrn: d.mrn || null,
          room: d.room || null,
          acuity: d.acuity,
          reason: d.reason,
          specialty,
          specialties: d.specialties,
          nurse_name: nurse.full_name,
          respond_by: expires,
          reply_url: REPLY_URL,
        });
        if (!r.ok || r.body["delivered"] === false) {
          status = "undelivered";
          deliveryError = r.ok ? String(r.body["reason"] ?? "not_delivered") : r.error;
        } else {
          threadId = r.body["thread_id"] ? String(r.body["thread_id"]) : null;
        }
      }
      await db.from("bedside_consults").update({ status, delivery_error: deliveryError, virtualis_thread_id: threadId }).eq("id", row.id);
      await audit(db, "consult.sent_to_virtualis", dev.device_id, row.id, status === "undelivered" ? "error" : "success", {
        specialty,
        physician_id: doc?.id ?? null,
        delivery_error: deliveryError,
      });
      results.push({ specialty, physician: doc?.name ?? null, status });
    }
    return { results };
  });

export type BedsideConsult = {
  id: string;
  patient_name: string;
  mrn: string | null;
  room: string | null;
  acuity: Acuity;
  reason: string;
  specialty: string;
  specialties: string[];
  physician_id: string | null;
  physician_name: string | null;
  nurse_name: string | null;
  status: ConsultStatus;
  delivery_error: string | null;
  created_at: string;
  expires_at: string;
  messages: { id: string; sender: "nurse" | "physician"; sender_name: string; body: string; created_at: string; delivered: boolean }[];
};

export const listBedsideConsults = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ deviceToken: z.string().min(8) }).parse(i))
  .handler(async ({ data }): Promise<BedsideConsult[]> => {
    const db = await admin();
    const dev = await deviceFor(db, data.deviceToken);
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await db
      .from("bedside_consults")
      .select("id, patient_name, mrn, room, acuity, reason, specialty, specialties, physician_id, physician_name, nurse_name, status, delivery_error, created_at, expires_at")
      .eq("device_id", dev.device_id)
      .neq("status", "called")
      .neq("status", "closed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10);
    const list = rows ?? [];
    const { data: msgs } = list.length
      ? await db
          .from("bedside_consult_messages")
          .select("id, consult_id, sender, sender_name, body, created_at, delivered")
          .in("consult_id", list.map((r) => r.id))
          .order("created_at")
      : { data: [] };
    return list.map((r) => ({
      ...(r as Omit<BedsideConsult, "messages">),
      status: effectiveStatus(r.status as ConsultStatus, r.expires_at),
      messages: (msgs ?? []).filter((m) => m.consult_id === r.id) as BedsideConsult["messages"],
    }));
  });

export const postBedsideMessage = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z
      .object({ deviceToken: z.string().min(8), nurseSession: z.string().min(8), consultId: z.string().uuid(), body: z.string().trim().min(1).max(2000) })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const dev = await deviceFor(db, data.deviceToken);
    const nurse = await nurseFor(db, data.deviceToken, data.nurseSession);
    const { data: c } = await db.from("bedside_consults").select("id, device_id, status").eq("id", data.consultId).maybeSingle();
    if (!c || c.device_id !== dev.device_id) throw new Error("Consult not found.");
    const { data: msg } = await db
      .from("bedside_consult_messages")
      .insert({ consult_id: c.id, sender: "nurse", sender_name: `RN ${nurse.full_name}`, body: data.body })
      .select("id")
      .single();
    const { deliverNurseMessage } = await import("@/lib/virtualis-chat.server");
    const r = await deliverNurseMessage({ external_id: c.id, message_id: msg!.id, sender_name: `RN ${nurse.full_name}`, body: data.body });
    if (!r.ok) await db.from("bedside_consult_messages").update({ delivered: false }).eq("id", msg!.id);
    await audit(db, "consult.message_sent", dev.device_id, c.id, r.ok ? "success" : "error", {});
    return { delivered: r.ok };
  });

export const startConsultVisit = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ deviceToken: z.string().min(8), consultId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const db = await admin();
    const dev = await deviceFor(db, data.deviceToken);
    const { data: c } = await db.from("bedside_consults").select("*").eq("id", data.consultId).maybeSingle();
    if (!c || c.device_id !== dev.device_id) throw new Error("Consult not found.");
    if (!c.physician_id || !canStartVisit(effectiveStatus(c.status as ConsultStatus, c.expires_at))) {
      throw new Error("The doctor hasn't said he's available yet.");
    }
    const { data: callId, error } = await db.rpc("place_public_call", {
      _device_token: data.deviceToken,
      _doctor_id: c.physician_id,
      _patient_room: c.room ?? "",
      _reason: c.reason,
      _patient_name: c.patient_name,
      _mrn: c.mrn ?? undefined,
      _acuity: c.acuity,
      _specialties: c.specialties,
    } as never);
    if (error || !callId) throw new Error(error?.message ?? "Could not start the video visit.");
    await db.from("calls").update({ nurse_name: c.nurse_name, nurse_staff_id: c.nurse_id }).eq("id", callId as string);
    await db.from("bedside_consults").update({ status: "called", call_id: callId as string }).eq("id", c.id);
    await audit(db, "consult.video_started", dev.device_id, c.id, "success", { call_id: callId });
    return { callId: callId as string, doctorId: c.physician_id as string };
  });

export const closeBedsideConsult = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ deviceToken: z.string().min(8), consultId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const db = await admin();
    const dev = await deviceFor(db, data.deviceToken);
    await db.from("bedside_consults").update({ status: "closed" }).eq("id", data.consultId).eq("device_id", dev.device_id);
    return { ok: true };
  });
