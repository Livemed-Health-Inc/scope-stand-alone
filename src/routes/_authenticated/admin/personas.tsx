import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, UserMinus, Copy, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listAccounts } from "@/lib/access.functions";
import { provisionPersonaAccount, setPersona } from "@/lib/persona-accounts.functions";
import { PERSONAS, personaLabel, type Persona } from "@/lib/permissions";
import { useAuth } from "@/lib/auth";
import { PhysiciansPage } from "./physicians";
import { TechsPage } from "./techs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";


export const Route = createFileRoute("/_authenticated/admin/personas")({
  head: () => ({
    meta: [
      { title: "Roles — LiveMed Admin" },
      {
        name: "description",
        content: "Create and manage hospital, physician, patient, field tech, analytics and admin logins by role.",
      },
      { property: "og:title", content: "Roles — LiveMed Admin" },
      { property: "og:description", content: "Directory of every LiveMed login grouped by role." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PersonasPage,
});

type Account = {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  personas: string[];
};

type Permission = { key: string; label: string; category: string; sort_order: number };

const ASSIGNABLE = PERSONAS.filter((p) => !p.legacy);


function PersonasPage() {
  const { personas: myPersonas } = useAuth();
  const isSuper = myPersonas.includes("super_admin");
  const fetchAccounts = useServerFn(listAccounts);
  const provision = useServerFn(provisionPersonaAccount);
  const changePersona = useServerFn(setPersona);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Persona>("doctor");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string; reset: boolean } | null>(null);

  async function load() {
    setLoading(true);
    try {
      setAccounts((await fetchAccounts()) as Account[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load accounts");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    accounts.forEach((a) => a.personas.forEach((p) => (map[p] = (map[p] ?? 0) + 1)));
    return map;
  }, [accounts]);

  const members = useMemo(
    () => accounts.filter((a) => a.personas.includes(active)),
    [accounts, active],
  );

  const activeMeta = ASSIGNABLE.find((p) => p.value === active);
  const locked = active === "super_admin" && !isSuper;
  const deviceOnly = active === "hospital";

  async function create() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const result = await provision({
        data: { email, fullName, persona: active, specialty: active === "doctor" ? specialty : undefined },
      });
      setIssued(result);
      setEmail("");
      setFullName("");
      setSpecialty("");
      toast.success(result.reset ? "Existing login updated" : `${personaLabel(active)} login created`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the login");
    }
    setBusy(false);
  }

  async function revoke(account: Account) {
    setBusy(true);
    try {
      await changePersona({ data: { userId: account.id, persona: active, grant: false } });
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, personas: a.personas.filter((p) => p !== active) } : a)),
      );
      toast.success(`${account.email} removed from ${personaLabel(active)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the persona");
    }
    setBusy(false);
  }

  return (
    <>
      <div>
        <p className="label-caps">Access control</p>
        <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every login belongs to one or more roles. Create logins here; tune what each role can do on the
          People &amp; personas screen.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ASSIGNABLE.map((p) => (
          <Button
            key={p.value}
            size="sm"
            variant={p.value === active ? "default" : "secondary"}
            className="gap-2"
            onClick={() => {
              setActive(p.value);
              setIssued(null);
            }}
          >
            {p.label}
            <Badge variant="outline">{counts[p.value] ?? 0}</Badge>
          </Button>
        ))}
      </div>

      <section className="panel-surface space-y-3 p-5">
        <div>
          <h2 className="text-lg font-semibold">
            {deviceOnly ? "Hospital access is device-based" : `Add a ${activeMeta?.label.toLowerCase()} login`}
          </h2>
          <p className="text-sm text-muted-foreground">{activeMeta?.blurb}</p>
        </div>

        {deviceOnly ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Hospitals do not get email logins. A field technician activates each bedside device with an
              enrollment code, and that device inherits the hospital role for its registered unit.
            </p>
            <p>
              Issue or review enrollment codes and devices under{" "}
              <span className="font-medium text-foreground">Hospital Onboarding</span>.
            </p>
          </div>
        ) : locked ? (
          <p className="text-sm text-muted-foreground">Only a super admin can manage this persona.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="p-email">Work email</Label>
              <Input
                id="p-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <Label htmlFor="p-name">Full name</Label>
              <Input id="p-name" placeholder="Alex Rivera" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            {active === "doctor" ? (
              <div className="min-w-[160px] flex-1">
                <Label htmlFor="p-spec">Specialty</Label>
                <Input id="p-spec" placeholder="Cardiology" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
              </div>
            ) : null}
            <Button className="gap-2" disabled={busy} onClick={() => void create()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create login
            </Button>
          </div>
        )}

        {issued ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {issued.reset ? "Password reset for" : "Login ready for"} {issued.email}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded bg-background px-2 py-1 font-mono text-xs">{issued.password}</code>
              <Button
                size="sm"
                variant="ghost"
                className="gap-2"
                onClick={() => {
                  void navigator.clipboard.writeText(issued.password);
                  toast.success("Temporary password copied");
                }}
              >
                <Copy className="size-4" /> Copy
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Share it once — it is shown only now. Ask them to change it after signing in.
            </p>
          </div>
        ) : null}
      </section>

      {active === "doctor" ? <PhysiciansPage /> : null}
      {active === "tech" ? <TechsPage /> : null}

      <section className="panel-surface p-5" hidden={deviceOnly}>
        <h2 className="text-lg font-semibold">{activeMeta?.label} accounts</h2>
        {loading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading accounts…
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {members.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{account.full_name || account.email}</p>
                  <p className="text-xs text-muted-foreground">{account.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {account.personas
                    .filter((p) => p !== active)
                    .map((p) => (
                      <Badge key={p} variant="secondary">
                        {personaLabel(p)}
                      </Badge>
                    ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2"
                    disabled={busy || locked}
                    onClick={() => void revoke(account)}
                  >
                    <UserMinus className="size-4" /> Remove
                  </Button>
                </div>
              </li>
            ))}
            {members.length === 0 ? (
              <li className="py-3 text-sm text-muted-foreground">No {activeMeta?.label.toLowerCase()} accounts yet.</li>
            ) : null}
          </ul>
        )}
      </section>
    </>
  );
}
