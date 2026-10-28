import { describe, expect, it } from "vitest";
import { workspaceContext, WORKSPACE_CONNECTIONS } from "./workspace-context";

describe("authorized call context only", () => {
  it("shares referral fields without asserting canonical identity", () => {
    const ctx = workspaceContext({ id: "call-123", patient_name: "Test patient", mrn: "TEST-12", patient_room: "12", hospital: "Test hospital", unit: "Test unit", reason: "Referral reason", nurse_name: "Test nurse", specialties: ["Cardiology"] });
    expect(ctx).toEqual({ callId: "call-123", canonicalEncounterId: null, patientName: "Test patient", mrn: "TEST-12", room: "12", hospital: "Test hospital", unit: "Test unit", reason: "Referral reason", nurseName: "Test nurse", acuity: null, specialties: ["Cardiology"] });
  });
  it("has no patient when no call is accepted", () => {
    expect(workspaceContext(null)).toBeNull();
  });
  it("does not fabricate missing patient or facility fields", () => {
    const ctx = workspaceContext({ id: "call", hospital: null, unit: null, reason: null, patient_room: null });
    expect(ctx?.mrn).toBeNull();
    expect(ctx?.canonicalEncounterId).toBeNull();
    expect(ctx?.specialties).toEqual([]);
    expect(ctx?.hospital).toBe("Hospital not provided");
  });
});

describe("first increment fail-closed capabilities", () => {
  it.each(["history", "chat", "note", "ambientCapture", "billing"] as const)("does not enable %s without an approved connection", (capability) => {
    expect(WORKSPACE_CONNECTIONS[capability]).toBe(false);
  });
});