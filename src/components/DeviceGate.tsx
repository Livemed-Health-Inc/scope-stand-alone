import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ActivationForm } from "@/components/ActivationForm";
import { supabase } from "@/integrations/supabase/client";
import { clearDeviceToken, getDeviceToken, type DeviceContext } from "@/lib/device";

export function DeviceGate({ children }: { children: (device: DeviceContext) => React.ReactNode }) {
  const [device, setDevice] = useState<DeviceContext | null>(null);
  const [checking, setChecking] = useState(true);

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

  if (checking) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking device registration…
      </div>
    );
  }

  if (!device) {
    return <ActivationForm onRegistered={verify} />;
  }

  return <>{children(device)}</>;
}
