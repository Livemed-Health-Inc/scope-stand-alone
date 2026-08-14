import { createFileRoute, Link } from "@tanstack/react-router";
import { Stethoscope, Building2 } from "lucide-react";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { NurseStation } from "@/components/NurseStation";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/nurse")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Nurse Station — Virtualis Consult" },
      {
        name: "description",
        content: "Bedside nurse station: see on-call physicians, their live status, and place a consult call in one tap.",
      },
      { property: "og:title", content: "Nurse Station — Virtualis Consult" },
      { property: "og:description", content: "See on-call physicians and place a remote stethoscope consult call." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NursePage,
});

function NursePage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark size={26} />
          </Link>
          <div className="hidden items-center gap-2 rounded-lg border border-border bg-panel/70 px-3 py-2 sm:flex">
            <Building2 className="size-4 text-muted-foreground" />
            <div className="leading-tight">
              <p className="text-xs font-medium">Bedside station</p>
              <p className="text-[0.68rem] uppercase tracking-widest text-muted-foreground">Nurse view</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ConnectionStatus />
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Doctor app</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <NurseStation />
      </main>
    </div>
  );
}
