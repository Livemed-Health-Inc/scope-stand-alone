import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const NAV: {
  to: "/admin" | "/admin/hospitals" | "/admin/physicians" | "/admin/techs" | "/admin/admins" | "/admin/access";
  label: string;
  exact?: boolean;
}[] = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/hospitals", label: "Hospitals" },
  { to: "/admin/physicians", label: "Physicians" },
  { to: "/admin/techs", label: "Field techs" },
  { to: "/admin/access", label: "People & personas" },
  { to: "/admin/admins", label: "Admins" },
];

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      let { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: uid });
      if (!isAdmin) {
        // LiveMed staff on the internal approved list get their admin role on first visit.
        const { data: claimed } = await supabase.rpc("claim_admin_role");
        isAdmin = Boolean(claimed);
      }
      if (active) setAllowed(Boolean(isAdmin));
    })();
    return () => {
      active = false;
    };
  }, []);

  if (allowed === null) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Checking access…</main>;
  }

  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="panel-surface max-w-md space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold">LiveMed administrators only</h1>
          <p className="text-sm text-muted-foreground">
            This console is restricted to approved LiveMed staff accounts. Hospital staff should use the physician app.
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link to="/doctor">Go to waiting room</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <BrandMark size={26} />
          <Badge variant="secondary" className="uppercase tracking-widest">
            LiveMed admin
          </Badge>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((n) => {
              const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
              return (
                <Button key={n.to} asChild size="sm" variant={active ? "secondary" : "ghost"}>
                  <Link to={n.to}>{n.label}</Link>
                </Button>
              );
            })}
          </nav>
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
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
