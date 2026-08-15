import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setDeviceToken, type DeviceContext } from "@/lib/device";

type ActivationFormProps = {
  initialCode?: string;
  onRegistered?: (device: DeviceContext) => void;
};

export function ActivationForm({ initialCode = "", onRegistered }: ActivationFormProps) {
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState("Bedside tablet");
  const [submitting, setSubmitting] = useState(false);

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
    onRegistered?.({
      device_id: "",
      hospital: row.hospital,
      unit: row.unit,
      label: row.label,
    });
  }

  return (
    <div className="mx-auto max-w-md space-y-4 py-10">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          <ShieldCheck className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Activate this tablet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Field tech: enter the activation code issued by the Virtualis administrator for this unit. The tablet is
          then bound to that hospital and unit — no nurse login required.
        </p>
      </div>
      <div className="panel-surface space-y-3 p-5">
        <div>
          <Label htmlFor="code">Activation code</Label>
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
