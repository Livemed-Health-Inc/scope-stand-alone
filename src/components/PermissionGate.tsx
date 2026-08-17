import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import type { PermissionKey } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * Renders children only when the signed-in persona has the feature permission.
 * Server-side RLS still enforces the real boundary; this is the UX layer.
 */
export function PermissionGate({
  permission,
  anyOf,
  title = "You don't have access to this area",
  children,
}: {
  permission?: PermissionKey;
  anyOf?: PermissionKey[];
  title?: string;
  children: ReactNode;
}) {
  const { loading, permissions } = useAuth();
  const required = anyOf ?? (permission ? [permission] : []);
  const allowed = required.length === 0 || required.some((p) => permissions.includes(p));

  if (loading) {
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
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Your account&apos;s persona doesn&apos;t include this feature. Ask a LiveMed administrator to update your
            access.
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link to="/home">Go to my home screen</Link>
          </Button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
