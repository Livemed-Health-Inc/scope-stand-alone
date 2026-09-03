import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { MfaSetup } from "@/components/MfaSetup";

export const Route = createFileRoute("/_authenticated/security")({
  head: () => ({
    meta: [
      { title: "Account Security — Virtualis Consult" },
      {
        name: "description",
        content:
          "Manage two-factor authentication for your Virtualis Consult account and keep patient data protected behind a second factor.",
      },
      { property: "og:title", content: "Account Security — Virtualis Consult" },
      {
        property: "og:description",
        content: "Add an authenticator app and review the second factor protecting your clinical account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <div>
        <p className="label-caps">Account protection</p>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Two-factor authentication is required for accounts that can reach patient information.
        </p>
      </div>

      <section className="panel-surface space-y-4 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h2 className="text-lg font-semibold">Two-factor authentication</h2>
        </div>
        <MfaSetup />
      </section>
    </main>
  );
}
