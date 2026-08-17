import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listAccounts } from "@/lib/access.functions";
import { PERSONAS, personaLabel, type Persona } from "@/lib/permissions";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/access")({
  component: AccessPage,
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

function AccessPage() {
  const { personas: myPersonas, refresh } = useAuth();
  const isSuper = myPersonas.includes("super_admin");
  const fetchAccounts = useServerFn(listAccounts);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [rows, perms, rolePerms] = await Promise.all([
        fetchAccounts(),
        supabase.from("permissions").select("key, label, category, sort_order").order("sort_order"),
        supabase.from("role_permissions").select("role, permission_key"),
      ]);
      setAccounts(rows as Account[]);
      setPermissions((perms.data ?? []) as Permission[]);
      const next: Record<string, Set<string>> = {};
      (rolePerms.data ?? []).forEach((rp) => {
        const role = rp.role as string;
        next[role] = (next[role] ?? new Set<string>()).add(rp.permission_key);
      });
      setMatrix(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load access settings");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => a.email.toLowerCase().includes(q) || a.full_name.toLowerCase().includes(q));
  }, [accounts, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    permissions.forEach((p) => map.set(p.category, [...(map.get(p.category) ?? []), p]));
    return [...map.entries()];
  }, [permissions]);

  async function togglePersona(account: Account, persona: Persona, on: boolean) {
    if (persona === "super_admin" && !isSuper) {
      toast.error("Only a super admin can grant the super admin persona");
      return;
    }
    setBusy(`${account.id}:${persona}`);
    const { error } = on
      ? await supabase.from("user_roles").insert({ user_id: account.id, role: persona })
      : await supabase.from("user_roles").delete().eq("user_id", account.id).eq("role", persona);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === account.id
          ? { ...a, personas: on ? [...a.personas, persona] : a.personas.filter((p) => p !== persona) }
          : a,
      ),
    );
    void refresh();
  }

  async function togglePermission(role: string, key: string, on: boolean) {
    setBusy(`${role}:${key}`);
    const { error } = on
      ? await supabase.from("role_permissions").insert({ role: role as Persona, permission_key: key })
      : await supabase.from("role_permissions").delete().eq("role", role as Persona).eq("permission_key", key);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMatrix((prev) => {
      const set = new Set(prev[role] ?? []);
      if (on) set.add(key);
      else set.delete(key);
      return { ...prev, [role]: set };
    });
    void refresh();
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading access settings…
      </p>
    );
  }

  return (
    <Tabs defaultValue="people">
      <TabsList>
        <TabsTrigger value="people">
          <UserCog className="size-4" /> People
        </TabsTrigger>
        {isSuper ? (
          <TabsTrigger value="matrix">
            <ShieldCheck className="size-4" /> Feature flags
          </TabsTrigger>
        ) : null}
      </TabsList>


      <TabsContent value="people" className="space-y-4">
        <div className="panel-surface space-y-3 p-5">
          <h1 className="text-lg font-semibold">People and personas</h1>
          <p className="text-sm text-muted-foreground">
            A login can hold more than one persona. What each persona can do is set on the Persona permissions tab.
          </p>
          <Input placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="space-y-3">
          {filtered.map((account) => (
            <div key={account.id} className="panel-surface space-y-3 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="font-medium">{account.full_name || account.email}</p>
                <p className="text-xs text-muted-foreground">{account.email}</p>
                {account.personas.length === 0 ? (
                  <Badge variant="secondary">No persona</Badge>
                ) : (
                  account.personas.map((p) => (
                    <Badge key={p} variant="secondary">
                      {personaLabel(p)}
                    </Badge>
                  ))
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {ASSIGNABLE.map((p) => {
                  const on = account.personas.includes(p.value);
                  const locked = p.value === "super_admin" && !isSuper;
                  return (
                    <Button
                      key={p.value}
                      size="sm"
                      variant={on ? "default" : "secondary"}
                      disabled={locked || busy === `${account.id}:${p.value}`}
                      title={locked ? "Super admins only" : p.blurb}
                      onClick={() => void togglePersona(account, p.value, !on)}
                    >
                      {p.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 ? <p className="text-sm text-muted-foreground">No accounts match that search.</p> : null}
        </div>
      </TabsContent>

      <TabsContent value="matrix" className="space-y-4">
        {!isSuper ? (
          <div className="panel-surface p-5 text-sm text-muted-foreground">
            Only a super admin can change feature flags.
          </div>
        ) : (
        <>
        <div className="panel-surface space-y-2 p-5">
          <h2 className="text-lg font-semibold">Feature flags</h2>
          <p className="text-sm text-muted-foreground">
            Tick a feature to turn it on for every account holding that role. Changes apply on the person&apos;s next
            screen load.
          </p>
        </div>


        {grouped.map(([category, perms]) => (
          <div key={category} className="panel-surface overflow-x-auto p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{category}</h3>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Feature</th>
                  {ASSIGNABLE.map((p) => (
                    <th key={p.value} className="pb-2 pr-3 font-medium">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perms.map((perm) => (
                  <tr key={perm.key} className="border-t border-border">
                    <td className="py-2 pr-4">{perm.label}</td>
                    {ASSIGNABLE.map((p) => {
                      const on = matrix[p.value]?.has(perm.key) ?? false;
                      return (
                        <td key={p.value} className="py-2 pr-3">
                          <Checkbox
                            checked={on}
                            disabled={busy === `${p.value}:${perm.key}`}
                            aria-label={`${p.label} — ${perm.label}`}
                            onCheckedChange={(v) => void togglePermission(p.value, perm.key, Boolean(v))}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        </>
        )}
      </TabsContent>

    </Tabs>
  );
}
