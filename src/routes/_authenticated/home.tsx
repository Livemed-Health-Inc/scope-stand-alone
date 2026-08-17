import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { homeForPermissions, personaLabel } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/home")({
  component: PersonaRouter,
});

function PersonaRouter() {
  const { loading, personas, permissions, signOut } = useAuth();
  const navigate = useNavigate();
  const destination = homeForPermissions(permissions);

  useEffect(() => {
    if (loading) return;
    if (destination !== "/no-access") void navigate({ to: destination, replace: true });
  }, [loading, destination]);

  if (loading || destination !== "/no-access") {
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
