import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Stethoscope, LogOut, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ensureStaffRecords } from "@/lib/staff";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { DoctorStation } from "@/components/DoctorStation";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/doctor")({
  head: () => ({
    meta: [
      { title: "Physician Waiting Room — Virtualis Consult" },
      {
        name: "description",
        content:
          "Physician app: go on-call, wait in the virtual room, accept bedside consults and run the remote stethoscope and A/V exam.",
      },
      { property: "og:title", content: "Physician Waiting Room — Virtualis Consult" },
      {
        property: "og:description",
        content: "Go on-call, accept bedside consult requests and run a remote auscultation exam.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DoctorAppPage,
});

function DoctorAppPage() {
  const { user, profile, loading, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (!user || bootstrapped) return;
    void ensureStaffRecords(user)
      .then(() => refresh())
      .finally(() => setBootstrapped(true));
  }, [user, bootstrapped]);

  if (loading || !bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading physician app…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2 text-primary">
            <Stethoscope className="size-5" />
            <span className="font-semibold tracking-tight text-foreground">Virtualis Consult</span>
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-border bg-panel/70 px-3 py-2 sm:flex">
            <Building2 className="size-4 text-muted-foreground" />
            <div className="leading-tight">
              <p className="text-xs font-medium">{profile?.full_name ?? "Physician"}</p>
              <p className="text-[0.68rem] uppercase tracking-widest text-muted-foreground">
                {profile?.specialty ?? "Physician app"}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ConnectionStatus />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={async () => {
                await signOut();
                void navigate({ to: "/auth" });
              }}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <DoctorStation />
      </main>
    </div>
  );
}
