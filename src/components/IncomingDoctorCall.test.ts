import { describe, expect, it } from "vitest";
import { dropInRemaining, DROP_IN_SECONDS } from "./IncomingDoctorCall";

describe("drop-in countdown", () => {
  it("auto-connects after 10 seconds", () => {
    expect(DROP_IN_SECONDS).toBe(10);
    expect(dropInRemaining(0, 0)).toBe(10);
    expect(dropInRemaining(0, 9999)).toBe(1);
    expect(dropInRemaining(0, 10000)).toBe(0);
  });
});
