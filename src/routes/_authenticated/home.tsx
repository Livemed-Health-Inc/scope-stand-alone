import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ensureStaffRecords } from "@/lib/staff";
import { homeForPermissions, personaLabel } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/home")({
  component: PersonaRouter,
});

function PersonaRouter() {
  const { loading, user, personas, permissions, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const destination = homeForPermissions(permissions);
  const bootstrapped = useRef(false);
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (destination !== "/no-access") void navigate({ to: destination, replace: true });
  }, [loading, destination]);

  // A freshly created account has no role row yet, so it would otherwise land
  // on the dead-end "no workspace" panel. Provision the persona chosen at
  // sign-up here, then re-read permissions and continue into the app.
  useEffect(() => {
    if (loading || !user || personas.length > 0 || bootstrapped.current) return;
    bootstrapped.current = true;
    setProvisioning(true);
    void ensureStaffRecords(user)
      .then(() => refresh())
      .finally(() => setProvisioning(false));
  }, [loading, user, personas.length]);

  if (loading || provisioning || destination !== "/no-access") {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Opening your workspace…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel-surface max-w-md space-y-4 p-6 text-center">
        <BrandMark size={30} labelClassName="text-base" />
        <h1 className="text-lg font-semibold">No workspace assigned yet</h1>
        <p className="text-sm text-muted-foreground">
          {personas.length
            ? `Your account holds the ${personas.map(personaLabel).join(", ")} persona, but it has no features enabled yet.`
            : "Your account hasn't been assigned a persona yet."}{" "}
          A LiveMed administrator can grant access.
        </p>
        <div className="flex justify-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to="/">Back to home</Link>
          </Button>
          <Button size="sm" onClick={() => void signOut().then(() => navigate({ to: "/auth", replace: true }))}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
