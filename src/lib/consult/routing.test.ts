import { describe, expect, it } from "vitest";
import { applyResponse, canStartVisit, effectiveStatus, pickPhysician, RESPONSE_WINDOW_MS } from "./routing";

const docs = [
  { id: "a", name: "Adams", specialty: "Cardiology", online: false, inConsult: false },
  { id: "b", name: "Baker", specialty: "Interventional cardiology", online: true, inConsult: true },
  { id: "c", name: "Cole", specialty: "Cardiology", online: true, inConsult: false },
  { id: "d", name: "Dunn", specialty: "Neurology", online: true, inConsult: false },
];

describe("bedside consult routing", () => {
  it("picks the available cardiologist first", () => {
    expect(pickPhysician(docs, "Cardiology")?.id).toBe("c");
  });
  it("returns no one when the specialty has no physician", () => {
    expect(pickPhysician(docs, "Nephrology")).toBeNull();
  });
  it("only allows the video visit after the doctor is available", () => {
    expect(canStartVisit("sent")).toBe(false);
    expect(canStartVisit("declined")).toBe(false);
    expect(canStartVisit("available")).toBe(true);
  });
  it("uses 5 min / 30 min / 4 hr response windows", () => {
    expect(RESPONSE_WINDOW_MS.critical).toBe(300_000);
    expect(RESPONSE_WINDOW_MS.urgent).toBe(1_800_000);
    expect(RESPONSE_WINDOW_MS.routine).toBe(14_400_000);
  });
  it("expires an unanswered consult past its window", () => {
    expect(effectiveStatus("sent", new Date(1000), 2000)).toBe("expired");
    expect(effectiveStatus("sent", new Date(3000), 2000)).toBe("sent");
  });
  it("ignores a response once the consult is no longer waiting", () => {
    expect(applyResponse("sent", "available")).toBe("available");
    expect(applyResponse("declined", "available")).toBeNull();
  });
});
