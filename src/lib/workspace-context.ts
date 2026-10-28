/** Consult call context is not a canonical One patient/encounter identity. */
export type WorkspaceCall = {
  id: string;
  patient_name?: string | null;
  mrn?: string | null;
  patient_room: string | null;
  hospital: string | null;
  unit: string | null;
  reason: string | null;
  acuity?: string | null;
  specialties?: string[] | null;
  nurse_name?: string | null;
};

export function workspaceContext(call: WorkspaceCall | null) {
  if (!call) return null;
  return {
    callId: call.id,
    canonicalEncounterId: null,
    patientName: call.patient_name || "Patient not provided",
    mrn: call.mrn || null,
    room: call.patient_room || null,
    hospital: call.hospital || "Hospital not provided",
    unit: call.unit || "Unit not provided",
    reason: call.reason || "Reason not provided",
    acuity: call.acuity || null,
    specialties: call.specialties ?? [],
    nurseName: call.nurse_name || null,
  };
}

/** No approved canonical encounter/consent/audio/Note contract in this increment. */
export const WORKSPACE_CONNECTIONS = Object.freeze({
  history: false,
  chat: false,
  note: false,
  ambientCapture: false,
  billing: false,
});