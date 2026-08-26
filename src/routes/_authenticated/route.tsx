import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { IdleTimeout } from "@/components/IdleTimeout";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();

  const lock = useCallback(async () => {
    await supabase.auth.signOut();
    toast.info("Signed out automatically after 15 minutes of inactivity.");
    void navigate({ to: "/auth", replace: true });
  }, [navigate]);

  return (
    <>
      <Outlet />
      <IdleTimeout idleMinutes={15} warnSeconds={60} onTimeout={lock} label="session" />
    </>
  );
}
