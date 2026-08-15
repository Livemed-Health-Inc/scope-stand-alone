import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/tech/facilities")({
  head: () => ({
    meta: [
      { title: "Choose Facility — Virtualis Field Tech" },
      { name: "description", content: "Select an existing hospital unit before activating an additional bedside tablet." },
      { property: "og:title", content: "Choose Facility — Virtualis Field Tech" },
      { property: "og:description", content: "Pick a live Virtualis hospital unit to add a bedside tablet to." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TechFacilities,
});

type Site = { id: string; hospital: string; unit: string; is_active: boolean };

function TechFacilities() {
  const [sites, setSites] = useState<Site[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("hospital_sites")
        .select("id, hospital, unit, is_active")
        .order("hospital")
        .order("unit");
      setSites((data as Site[] | null) ?? []);
    })();
  }, []);

  const term = q.trim().toLowerCase();
  const filtered = term
    ? sites.filter((s) => `${s.hospital} ${s.unit}`.toLowerCase().includes(term))
    : sites;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="w-fit gap-2">
        <Link to="/tech">
          <ArrowLeft className="size-4" /> Back
        </Link>
      </Button>

      <div>
        <p className="label-caps">Step 1</p>
        <h1 className="text-2xl font-semibold tracking-tight">Select the facility</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the hospital unit this tablet belongs to, then enter the activation code issued by LiveMed.
        </p>
      </div>

      <Input placeholder="Search hospital or unit" value={q} onChange={(e) => setQ(e.target.value)} />

      <ul className="space-y-2">
        {filtered.map((s) => (
          <li key={s.id} className="panel-surface flex flex-wrap items-center gap-3 p-4">
            <Building2 className="size-5 text-primary" />
            <div>
              <p className="text-sm font-medium">{s.hospital}</p>
              <p className="text-xs text-muted-foreground">{s.unit}</p>
            </div>
            {!s.is_active && <Badge variant="secondary">Inactive</Badge>}
            <Button asChild size="sm" className="ml-auto" disabled={!s.is_active}>
              <Link to="/tech/activate" search={{ site: s.id, code: "" }}>
                Add tablet
              </Link>
            </Button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="panel-surface p-4 text-sm text-muted-foreground">No hospital units match that search.</li>
        )}
      </ul>
    </>
  );
}
