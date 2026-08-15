import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/admins")({
  head: () => ({
    meta: [
      { title: "Approved Admins — LiveMed Admin" },
      { name: "description", content: "Manage the internal list of LiveMed staff emails allowed to hold admin access." },
      { property: "og:title", content: "Approved Admins — LiveMed Admin" },
      { property: "og:description", content: "Control which LiveMed staff emails can open the admin console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminsPage,
});

type Entry = { email: string; note: string | null; created_at: string };

function AdminsPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const { data } = await supabase.from("admin_allowlist").select("email, note, created_at").order("created_at");
    setEntries((data as Entry[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add() {
    const value = email.trim().toLowerCase();
    if (!value) return;
    const { error } = await supabase.from("admin_allowlist").insert({ email: value, note: note.trim() || null });
    if (error) {
      toast.error(error.message);
      return;
    }
    setEmail("");
    setNote("");
    void load();
  }

  async function remove(target: string) {
    const { error: delErr } = await supabase.from("admin_allowlist").delete().eq("email", target);
    if (delErr) {
      toast.error(delErr.message);
      return;
    }
    toast.success(`${target} removed from the approved list`);
    void load();
  }

  return (
    <>
      <div>
        <p className="label-caps">Access control</p>
        <h1 className="text-2xl font-semibold tracking-tight">Approved LiveMed admins</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin rights cannot be self-assigned at sign-up. Only accounts whose work email appears here gain access to
          this console, on their first visit after signing in.
        </p>
      </div>

      <section className="panel-surface space-y-3 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label htmlFor="email">LiveMed work email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@livemedhealth.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <Label htmlFor="note">Note</Label>
            <Input id="note" placeholder="Ops manager" value={note} onChange={(e) => setNote(e.target.value)} />
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
          {entries.length === 0 && <li className="py-3 text-sm text-muted-foreground">No approved emails yet.</li>}
        </ul>
      </section>
    </>
  );
}
