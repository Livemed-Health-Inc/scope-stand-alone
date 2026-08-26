import { useEffect, useState } from "react";
import { Loader2, Eye } from "lucide-react";
import { ActivationForm } from "@/components/ActivationForm";
import { supabase } from "@/integrations/supabase/client";
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
  const [preview, setPreview] = useState(false);

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
    setPreview(isPreviewSession());
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

  return (
    <>
      {preview && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <Eye className="size-4 shrink-0" />
          <span>
            <strong>Admin preview</strong> — this is the live bedside station for {device.hospital} · {device.unit}. Calls
            placed here really ring physicians.
          </span>
        </div>
      )}
      {children(device)}
    </>
  );
}
