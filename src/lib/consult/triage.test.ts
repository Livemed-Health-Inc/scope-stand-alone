import { describe, expect, it } from "vitest";
import { suggestAcuity, suggestSpecialties } from "./triage";

describe("consult triage", () => {
  it("chest pain is critical with Cardiology first", () => {
    const text = "Room 404 chest pain with escalating O2 requirement";
    expect(suggestAcuity(text)).toBe("critical");
    expect(suggestSpecialties(text)[0]?.specialty).toBe("Cardiology");
    expect(suggestSpecialties(text).map((s) => s.specialty)).toContain("Pulmonology");
  });

  it("seizure suggests Neurology", () => {
    expect(suggestSpecialties("new onset seizure").map((s) => s.specialty)).toContain("Neurology");
  });

  it("unrelated text suggests nothing", () => {
    expect(suggestSpecialties("family visiting this afternoon")).toEqual([]);
    expect(suggestAcuity("")).toBeNull();
  });
});
