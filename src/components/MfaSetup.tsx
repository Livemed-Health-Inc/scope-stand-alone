import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { auditLog } from "@/lib/audit";

type Factor = { id: string; friendly_name?: string | null; status: string };

/**
 * Authenticator-app (TOTP) enrollment for a signed-in user.
 *
 * HIPAA access control: a second factor is required before a login can be
 * treated as trusted for patient-data access.
 */
export function MfaSetup() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) toast.error(error.message);
    setFactors(((data?.totp ?? []) as Factor[]).filter((f) => f.status === "verified"));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startEnroll() {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toLocaleDateString()}`,
    });
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not start enrollment");
      return;
    }
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll() {
    if (!enrolling) return;
    setBusy(true);
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
    if (cErr || !challenge) {
      setBusy(false);
      toast.error(cErr?.message ?? "Could not verify code");
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: enrolling.id,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    void auditLog({ action: "auth.mfa_enrolled", entity: "auth.mfa_factors", entityId: enrolling.id });
    setEnrolling(null);
    setCode("");
    toast.success("Two-factor authentication is now active.");
    void load();
  }

  async function remove(id: string) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) {
      toast.error(error.message);
      return;
    }
    void auditLog({ action: "auth.mfa_removed", entity: "auth.mfa_factors", entityId: id, outcome: "success" });
    toast.success("Authenticator removed.");
    void load();
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking your security settings…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {factors.length > 0 ? (
        <ul className="divide-y divide-border">
          {factors.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">{f.friendly_name || "Authenticator app"}</p>
                  <p className="text-xs text-muted-foreground">Required at every sign-in</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Active</Badge>
                <Button size="sm" variant="ghost" onClick={() => void remove(f.id)} aria-label="Remove authenticator">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No second factor yet. Add an authenticator app (Google Authenticator, Authy, 1Password) so a stolen password
          alone can never reach patient data.
        </p>
      )}

      {enrolling ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
          <img src={enrolling.qr} alt="Two-factor authentication setup QR code" className="size-44 rounded bg-white p-2" />
          <p className="text-xs text-muted-foreground">
            Can&apos;t scan? Enter this key manually: <code className="font-mono">{enrolling.secret}</code>
          </p>
          <div className="max-w-[200px]">
            <Label htmlFor="mfa-code">6-digit code</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || code.trim().length < 6} onClick={() => void confirmEnroll()}>
              Activate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEnrolling(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button className="gap-2" disabled={busy} onClick={() => void startEnroll()}>
          <KeyRound className="size-4" /> Add authenticator app
        </Button>
      )}
    </div>
  );
}
