import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearDeviceToken, getDeviceToken, setDeviceToken, type DeviceContext } from "@/lib/device";

export function DeviceGate({ children }: { children: (device: DeviceContext) => React.ReactNode }) {
  const [device, setDevice] = useState<DeviceContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("Bedside tablet");
  const [submitting, setSubmitting] = useState(false);

  async function verify() {
    const token = getDeviceToken();
    if (!token) {
      setChecking(false);
      return;
    }
    const { data } = await supabase.rpc("device_context", { _device_token: token });
    const ctx = (data ?? [])[0] as DeviceContext | undefined;
    if (!ctx) {
      clearDeviceToken();
      setDevice(null);
    } else {
      setDevice(ctx);
    }
    setChecking(false);
  }

  useEffect(() => {
    void verify();
    const interval = window.setInterval(() => void verify(), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  async function register() {
    setSubmitting(true);
    const { data, error } = await supabase.rpc("redeem_enrollment_code", {
      _code: code.trim().toUpperCase(),
      _label: label,
    });
    setSubmitting(false);
    const row = (data ?? [])[0] as
      | { device_token: string; hospital: string; unit: string; label: string }
      | undefined;
    if (error || !row) {
      toast.error(error?.message ?? "That enrollment code is not valid.");
      return;
    }
    setDeviceToken(row.device_token);
    toast.success(`Device registered to ${row.hospital} · ${row.unit}`);
    void verify();
  }

  if (checking) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking device registration…
      </div>
    );
  }

  if (!device) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-10">
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <ShieldCheck className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Register this device</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the enrollment code from your unit administrator. This tablet will then be tied to that hospital and
            unit — no nurse login required.
          </p>
        </div>
        <div className="panel-surface space-y-3 p-5">
          <div>
            <Label htmlFor="code">Enrollment code</Label>
            <Input
              id="code"
              value={code}
              placeholder="A1B2C3D4"
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <Label htmlFor="label">Device name</Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button className="w-full" disabled={!code.trim() || submitting} onClick={register}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : "Register device"}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children(device)}</>;
}
