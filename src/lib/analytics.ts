import { supabase } from "@/integrations/supabase/client";
import { getDeviceToken } from "@/lib/device";

export type CallEventKind =
  | "visit_join"
  | "visit_leave"
  | "stethoscope_session"
  | "auscultation_site"
  | "recording"
  | "camera_switch"
  | "mic_toggle"
  | "camera_toggle";

export type CallEvent = {
  kind: CallEventKind;
  /** Consult id (the calls row). */
  callId?: string | null;
  /** Auscultation site / mode, e.g. "Heart", "Lung". */
  site?: string | null;
  durationMs?: number;
  details?: Record<string, unknown>;
};

/**
 * Records one consult telemetry event. Never throws — analytics must never
 * interrupt a live clinical encounter.
 */
export async function logCallEvent(event: CallEvent): Promise<void> {
  try {
    const args: Record<string, unknown> = {
      _kind: event.kind,
      _duration_ms: Math.max(0, Math.round(event.durationMs ?? 0)),
      _details: event.details ?? {},
    };
    if (event.callId) args["_call_id"] = event.callId;
    if (event.site) args["_site"] = event.site;
    const token = getDeviceToken();
    if (token) args["_device_token"] = token;

    const { error } = await supabase.rpc("log_call_event", args as never);
    if (error) console.warn("[analytics] event dropped", error.message);
  } catch (err) {
    console.warn("[analytics] event dropped", err);
  }
}
