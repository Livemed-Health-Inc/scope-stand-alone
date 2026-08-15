import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/tech")({
  component: TechLayout,
});

function TechLayout() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      const { data: isTech } = await supabase.rpc("is_tech", { _user_id: uid });
      if (active) setAllowed(Boolean(isTech));
    })();
    return () => {
      active = false;
    };
  }, []);

  if (allowed === null) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="panel-surface max-w-md space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold">Field technicians only</h1>
          <p className="text-sm text-muted-foreground">
            This console is limited to approved LiveMed installation staff. Ask a LiveMed administrator to add your work
            email to the field-tech list.
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link to="/tech" className="flex items-center gap-2">
            <BrandMark size={26} />
          </Link>
          <Badge variant="secondary" className="uppercase tracking-widest">
            Field tech
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            className="ml-auto"
            onClick={async () => {
              await supabase.auth.signOut();
              void navigate({ to: "/auth", replace: true });
            }}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
