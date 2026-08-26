import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { ActivationForm } from "@/components/ActivationForm";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { IdleTimeout } from "@/components/IdleTimeout";
import { supabase } from "@/integrations/supabase/client";
import { auditLog } from "@/lib/audit";
import {
  clearDeviceToken,
  clearPreviewToken,
  getDeviceToken,
  isPreviewSession,
  setPreviewToken,
  type DeviceContext,
} from "@/lib/device";

export function DeviceGate({ children }: { children: (device: DeviceContext) => React.ReactNode }) {
  const [device, setDevice] = useState<DeviceContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(false);

  async function verify() {
    const token = getDeviceToken();
    if (!token) {
      setChecking(false);
      return;
    }
    const { data } = await supabase.rpc("device_context", { _device_token: token });
    const ctx = (data ?? [])[0] as DeviceContext | undefined;
    if (!ctx) {
      if (isPreviewSession()) clearPreviewToken();
      else clearDeviceToken();
      setDevice(null);
    } else {
      setDevice(ctx);
    }
    setChecking(false);
  }

  useEffect(() => {
    // Admin bedside preview: consume ?preview=<token> into a tab-scoped slot.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const token = url.searchParams.get("preview");
      if (token) {
        setPreviewToken(token);
        url.searchParams.delete("preview");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      }
    }
    void verify();
    const interval = window.setInterval(() => void verify(), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const lock = useCallback(() => {
    setLocked(true);
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

  // Privacy screen: an unattended cart must not leave patient context visible.
  if (locked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
        <BrandMark size={40} />
        <Lock className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Screen locked for patient privacy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {device.hospital} · {device.unit}
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            void auditLog({ action: "bedside.unlock", entity: "devices", entityId: device.device_id, withDevice: true });
            setLocked(false);
          }}
        >
          Resume bedside station
        </Button>
      </main>
    );
  }

  return (
    <>
      {children(device)}
      <IdleTimeout idleMinutes={10} warnSeconds={45} onTimeout={lock} label="bedside station" />
    </>
  );
}
