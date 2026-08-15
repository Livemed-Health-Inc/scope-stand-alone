import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BrandMark } from "@/components/BrandMark";
import { ActivationForm } from "@/components/ActivationForm";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/nurse/activate")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Activate Tablet — Virtualis Consult" },
      {
        name: "description",
        content: "Field tech activation page for a bedside nurse tablet.",
      },
      { property: "og:title", content: "Activate Tablet — Virtualis Consult" },
      { property: "og:description", content: "Activate a bedside nurse tablet with an enrollment code." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code : "",
  }),
  component: ActivatePage,
});

function ActivatePage() {
  const navigate = useNavigate();
  const { code } = useSearch({ from: "/nurse/activate" });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark size={26} />
          </Link>
          <div className="ml-auto">
            <Button asChild variant="ghost" size="sm">
              <Link to="/nurse">Nurse station</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <ActivationForm initialCode={code} onRegistered={() => navigate({ to: "/nurse" })} />
      </main>
    </div>
  );
}
