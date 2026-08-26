import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getDeviceToken } from "@/lib/device";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign In — Virtualis Consult" },
      {
        name: "description",
        content:
          "Sign in to Virtualis Consult: bedside-to-physician consults with live presence and a remote digital stethoscope exam.",
      },
      { property: "og:title", content: "Sign In — Virtualis Consult" },
      {
        property: "og:description",
        content: "Sign in to reach on-call physicians or run a remote stethoscope consult.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RootRedirect,
});

/** No marketing page: an activated bedside device goes to the nurse station, everyone else signs in. */
function RootRedirect() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (getDeviceToken()) {
      void navigate({ to: "/nurse", replace: true });
      return;
    }
    if (loading) return;
    void navigate({ to: user ? "/home" : "/auth", replace: true });
  }, [loading, user]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Opening Virtualis Consult…
    </main>
  );
}
