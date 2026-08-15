import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ActivationForm } from "@/components/ActivationForm";

export const Route = createFileRoute("/_authenticated/tech/activate")({
  head: () => ({
    meta: [
      { title: "Activate Tablet — Virtualis Field Tech" },
      { name: "description", content: "Bind a bedside tablet to a hospital unit using a LiveMed activation code." },
      { property: "og:title", content: "Activate Tablet — Virtualis Field Tech" },
      { property: "og:description", content: "Field technician tablet activation for Virtualis bedside stations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    site: typeof search["site"] === "string" ? (search["site"] as string) : "",
    code: typeof search["code"] === "string" ? (search["code"] as string) : "",
  }),
  component: TechActivate,
});

function TechActivate() {
  const navigate = useNavigate();
  const { site, code } = useSearch({ from: "/_authenticated/tech/activate" });
  const [siteLabel, setSiteLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!site) return;
    let active = true;
    void (async () => {
      const { data } = await supabase.from("hospital_sites").select("hospital, unit").eq("id", site).maybeSingle();
      if (active && data) setSiteLabel(`${data.hospital} · ${data.unit}`);
    })();
    return () => {
      active = false;
    };
  }, [site]);

  return (
    <>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-2">
          <Link to="/tech">
            <ArrowLeft className="size-4" /> Back
          </Link>
        </Button>
      </div>

      <div>
        <p className="label-caps">Step 2</p>
        <h1 className="text-2xl font-semibold tracking-tight">Activate this tablet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {siteLabel
            ? `Enter the activation code LiveMed issued for ${siteLabel}.`
            : "Enter the activation code LiveMed issued for this hospital unit."}
        </p>
      </div>

      <ActivationForm initialCode={code} onRegistered={() => navigate({ to: "/nurse" })} />
    </>
  );
}
