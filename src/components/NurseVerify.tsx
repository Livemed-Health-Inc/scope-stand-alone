import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, KeyRound, Loader2, MessageSquareText, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BrandMark } from "@/components/BrandMark";
import { getDeviceToken, setNurseSession, type DeviceContext, type NurseSession } from "@/lib/device";
import { sendNurseCode, verifyNurseCode } from "@/lib/nurse-otp.functions";

type UnitNurse = { id: string; full_name: string; phone_last4: string | null; has_sms: boolean; has_totp: boolean };

export function NurseVerify({ device, onVerified, onCancel }: { device: DeviceContext; onVerified: (s: NurseSession) => void; onCancel?: () => void }) {
  const [nurses, setNurses] = useState<UnitNurse[] | null>(null);
  const [nurseId, setNurseId] = useState("");
  const [method, setMethod] = useState<"sms" | "totp" | null>(null);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const send = useServerFn(sendNurseCode);
  const verify = useServerFn(verifyNurseCode);

  useEffect(() => {
    const token = getDeviceToken();
    if (!token) return;
    void supabase.rpc("device_nurses", { _device_token: token }).then(({ data }) => setNurses((data ?? []) as UnitNurse[]));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const nurse = nurses?.find((n) => n.id === nurseId);

  function pick(id: string) {
    setNurseId(id);
    const n = nurses?.find((x) => x.id === id);
    setMethod(n?.has_totp ? "totp" : n?.has_sms ? "sms" : null);
    setSent(false);
    setCode("");
  }

  async function sendCode() {
    const token = getDeviceToken();
    if (!token || !nurse) return;
    setBusy(true);
    try {
      const r = await send({ data: { deviceToken: token, nurseId: nurse.id } });
      if (r.ok) {
        setSent(true);
        setCooldown(30);
        toast.success(`Code sent to •••• ${nurse.phone_last4}`);
      } else toast.error(r.error);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const token = getDeviceToken();
    if (!token || !nurse || !method) return;
    setBusy(true);
    try {
      const r = await verify({ data: { deviceToken: token, nurseId: nurse.id, code, method } });
      if (!r.ok) {
        toast.error(r.error);
        setCode("");
        return;
      }
      const s: NurseSession = { session: r.session, nurseId: nurse.id, fullName: r.fullName, expiresAt: r.expiresAt };
      setNurseSession(s);
      onVerified(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't verify the code.");
    } finally {
      setBusy(false);
    }
  }

  const showCodeInput = method === "totp" || (method === "sms" && sent);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 py-10">
      {onCancel && (
        <div>
          <Button variant="ghost" size="sm" className="gap-2 -ml-2" onClick={onCancel}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
      )}
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark size={36} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Who's at the bedside?</h1>
          <p className="text-sm text-muted-foreground">
            {device.hospital} · {device.unit}
          </p>
        </div>
      </div>

      <div className="glass-card space-y-4 p-5">
        {nurses === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading unit nurses…
          </p>
        ) : nurses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No nurses are set up for this unit yet. Ask a LiveMed administrator to add them on Hospital Onboarding.
          </p>
        ) : (
          <>
            <div>
              <label className="text-sm font-medium">Your name</label>
              <Select value={nurseId} onValueChange={pick}>
                <SelectTrigger className="mt-1 h-12">
                  <SelectValue placeholder="Select your name" />
                </SelectTrigger>
                <SelectContent>
                  {nurses.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      <span className="flex items-center gap-2">
                        <UserRound className="size-4" /> {n.full_name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {nurse && !nurse.has_sms && !nurse.has_totp && (
              <p className="text-sm text-destructive">
                No verification method is set up for you. Ask an administrator to add your mobile number or authenticator.
              </p>
            )}

            {nurse && (nurse.has_sms || nurse.has_totp) && (
              <div className="flex rounded-lg bg-muted p-1">
                {nurse.has_totp && (
                  <button
                    type="button"
                    onClick={() => {
                      setMethod("totp");
                      setCode("");
                    }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium ${
                      method === "totp" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"
                    }`}
                  >
                    <KeyRound className="size-4" /> Authenticator app
                  </button>
                )}
                {nurse.has_sms && (
                  <button
                    type="button"
                    onClick={() => {
                      setMethod("sms");
                      setCode("");
                    }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium ${
                      method === "sms" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"
                    }`}
                  >
                    <MessageSquareText className="size-4" /> Text me a code
                  </button>
                )}
              </div>
            )}

            {method === "sms" && nurse && (
              <Button variant={sent ? "secondary" : "default"} className="w-full" disabled={busy || cooldown > 0} onClick={sendCode}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : sent ? "Resend code" : `Text a code to •••• ${nurse.phone_last4}`}
              </Button>
            )}

            {showCodeInput && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div>
                  <label className="text-sm font-medium" htmlFor="nurse-code">
                    {method === "totp" ? "6-digit code from your authenticator app" : "6-digit code from the text"}
                  </label>
                  <Input
                    id="nurse-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="mt-1 h-12 text-center font-mono text-2xl tracking-[0.5em]"
                    autoFocus
                  />
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify and open station"}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
