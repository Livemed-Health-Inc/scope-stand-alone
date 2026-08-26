import { supabase } from "@/integrations/supabase/client";
import { getDeviceToken } from "@/lib/device";
import { scrubPhiDeep } from "@/lib/phi";

export type AuditEvent = {
  action: string;
  entity?: string | null;
  entityId?: string | null;
  /** True when the action exposed or changed patient information. */
  phi?: boolean;
  outcome?: "success" | "denied" | "error";
  details?: Record<string, unknown>;
  /** Include the bedside device token so kiosk actions are attributable. */
  withDevice?: boolean;
};

/**
 * Appends an entry to the tamper-evident audit trail.
 *
 * Never throws: a failed audit write must not break clinical workflow, but it
 * is surfaced in the console so it can be investigated.
 */
export async function auditLog(event: AuditEvent): Promise<void> {
  try {
    const { error } = await supabase.rpc("log_audit_event", {
      _action: event.action,
      _entity: event.entity ?? null,
      _entity_id: event.entityId ?? null,
      _phi_accessed: event.phi ?? false,
      _outcome: event.outcome ?? "success",
      _details: scrubPhiDeep(event.details ?? {}),
      _device_token: event.withDevice ? getDeviceToken() : null,
    });
    if (error) console.warn("[audit] write failed", error.message);
  } catch (err) {
    console.warn("[audit] write failed", err);
  }
}
