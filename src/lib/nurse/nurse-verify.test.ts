import { describe, expect, it } from "vitest";
import { attemptAllowed, canResend, CODE_TTL_MS, isExpired } from "./otp-rules";
import { base32Encode, hotp, stepAt, verifyTotp } from "./totp";

const rfcSecret = base32Encode(new TextEncoder().encode("12345678901234567890"));

describe("text code rules", () => {
  it("expires at 5 minutes", () => {
    const sent = 1_000_000;
    expect(isExpired(sent + CODE_TTL_MS - 1, sent)).toBe(false);
    expect(isExpired(sent + 5 * 60_000, sent + 5 * 60_000)).toBe(true);
  });
  it("rejects the 6th try", () => {
    expect(attemptAllowed(4)).toBe(true);
    expect(attemptAllowed(5)).toBe(false);
  });
  it("rejects resend inside 30 seconds", () => {
    expect(canResend(0, 29_999)).toBe(false);
    expect(canResend(0, 30_000)).toBe(true);
  });
});

describe("authenticator codes", () => {
  it("matches the RFC 6238 SHA-1 test vector", async () => {
    // T = 59 s → counter 1 → 94287082 (8 digits)
    expect(await hotp(new TextEncoder().encode("12345678901234567890"), 1, 8)).toBe("94287082");
  });
  it("rejects a code from 2 steps ago", async () => {
    const now = 1_700_000_000_000;
    const old = await hotp(new TextEncoder().encode("12345678901234567890"), stepAt(now) - 2);
    expect(await verifyTotp(rfcSecret, old, now, null)).toBeNull();
  });
  it("cannot reuse the same code", async () => {
    const now = 1_700_000_000_000;
    const code = await hotp(new TextEncoder().encode("12345678901234567890"), stepAt(now));
    const step = await verifyTotp(rfcSecret, code, now, null);
    expect(step).toBe(stepAt(now));
    expect(await verifyTotp(rfcSecret, code, now, step)).toBeNull();
  });
});
