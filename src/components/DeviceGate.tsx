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
  getNurseSession,
  clearNurseSession,
  type DeviceContext,
  type NurseSession,
} from "@/lib/device";
import { NurseVerify } from "@/components/NurseVerify";

const ADMIN_PREVIEW_FLAG = "virtualis.device.adminpreview";
const isAdminPreview = () =>
  typeof window !== "undefined" && window.sessionStorage.getItem(ADMIN_PREVIEW_FLAG) === "1";

export type VerifyNurse = () => Promise<NurseSession | null>;

export function DeviceGate({ children }: { children: (device: DeviceContext, nurse: NurseSession | null, signOutNurse: () => void, verifyNurse: VerifyNurse) => React.ReactNode }) {
  const [device, setDevice] = useState<DeviceContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(false);
  const [nurse, setNurse] = useState<NurseSession | null>(null);
  // On-demand nurse verification (consult creation flow): the station renders
  // without identity; asking "Who's at the bedside?" happens only when a
  // consult is composed.
  const [verifyRequest, setVerifyRequest] = useState<{ resolve: (s: NurseSession | null) => void } | null>(null);

  const verifyNurse: VerifyNurse = useCallback(
    () =>
      new Promise<NurseSession | null>((resolve) => {
        setVerifyRequest({ resolve });
      }),
    [],
  );

  async function checkNurse(token: string) {
    const s = getNurseSession();
    if (!s) {
      setNurse(null);
    } else {
      const { data } = await supabase.rpc("nurse_from_session", { _device_token: token, _session: s.session });
      if ((data ?? []).length) setNurse(s);
      else {
        clearNurseSession();
        setNurse(null);
      }
    }
  }

  const signOutNurse = useCallback(() => {
    const s = getNurseSession();
    const token = getDeviceToken();
    if (s && token) {
      void supabase.rpc("end_nurse_session", { _device_token: token, _session: s.session });
      void auditLog({ action: "nurse.signed_out", entity: "unit_nurses", entityId: s.nurseId, withDevice: true });
    }
    clearNurseSession();
    setNurse(null);
  }, []);

  async function verify() {
    let token = getDeviceToken();

    // Hospital bedside login: a signed-in unit account gets a fresh, tab-scoped
    // bedside session without ever registering this browser as a tablet.
    if (!token) {
      const { data: session } = await supabase.auth.getSession();
      if (session.session) {
        const { data: minted } = await supabase.rpc("bedside_session_token");
        const row = (minted ?? [])[0] as { device_token: string } | undefined;
        if (row?.device_token) {
          setPreviewToken(row.device_token);
          token = row.device_token;
        }
      }
    }

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
      await checkNurse(token);
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
        window.sessionStorage.setItem(ADMIN_PREVIEW_FLAG, "1");
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
    signOutNurse();
    setVerifyRequest((r) => {
      r?.resolve(null);
      return null;
    });
  }, [signOutNurse]);

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

  const adminPreview = isAdminPreview();
  if (!adminPreview && !locked && !nurse) {
    if (!nurseChecked) {
      return (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking nurse sign-in…
        </div>
      );
    }
    return <NurseVerify device={device} onVerified={setNurse} />;
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
      {children(device, nurse, signOutNurse)}
      <IdleTimeout idleMinutes={10} warnSeconds={45} onTimeout={lock} label="bedside station" />
    </>
  );
}
