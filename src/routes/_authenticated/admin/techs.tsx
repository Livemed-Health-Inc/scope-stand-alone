import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { provisionTechAccount } from "@/lib/tech-accounts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/techs")({
  head: () => ({
    meta: [
      { title: "Field Techs — LiveMed Admin" },
      {
        name: "description",
        content: "Approve the LiveMed field technicians allowed to activate bedside tablets during installation.",
      },
      { property: "og:title", content: "Field Techs — LiveMed Admin" },
      { property: "og:description", content: "Control which installer accounts can open the field-tech console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TechsPage,
});

type Entry = { email: string; note: string | null; created_at: string };

function TechsPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const { data } = await supabase.from("tech_allowlist").select("email, note, created_at").order("created_at");
    setEntries((data as Entry[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add() {
    const value = email.trim().toLowerCase();
    if (!value) return;
    const { error } = await supabase.from("tech_allowlist").insert({ email: value, note: note.trim() || null });
    if (error) {
      toast.error(error.message);
      return;
    }
    setEmail("");
    setNote("");
    toast.success(`${value} can now open the field-tech console`);
    void load();
  }

  async function remove(target: string) {
    const { error } = await supabase.from("tech_allowlist").delete().eq("email", target);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${target} removed`);
    void load();
  }

  return (
    <>
      <div>
        <p className="label-caps">Access control</p>
        <h1 className="text-2xl font-semibold tracking-tight">Approved field techs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Field techs sign in at <span className="font-medium text-foreground">/tech</span> to activate bedside tablets.
          They can see hospital units but never issue activation codes — those come from this console.
        </p>
      </div>

      <section className="panel-surface space-y-3 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label htmlFor="tech-email">Field tech work email</Label>
            <Input
              id="tech-email"
              type="email"
              placeholder="tech@livemedhealth.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <Label htmlFor="tech-note">Note</Label>
            <Input id="tech-note" placeholder="Midwest region" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={add} className="gap-2">
            <Plus className="size-4" /> Approve
          </Button>
        </div>

        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <li key={e.email} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <p className="text-sm font-medium">{e.email}</p>
                <p className="text-xs text-muted-foreground">{e.note ?? "—"}</p>
              </div>
              <Button size="sm" variant="ghost" className="gap-2" onClick={() => remove(e.email)}>
                <Trash2 className="size-4" /> Remove
              </Button>
            </li>
          ))}
          {entries.length === 0 && <li className="py-3 text-sm text-muted-foreground">No approved field techs yet.</li>}
        </ul>
      </section>
    </>
  );
}
