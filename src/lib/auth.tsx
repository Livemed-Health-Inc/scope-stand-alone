import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Persona, PermissionKey } from "@/lib/permissions";

export type StaffRole = "doctor" | "nurse";

export type Profile = {
  id: string;
  full_name: string;
  specialty: string | null;
  hospital: string;
  unit: string;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Legacy clinical role, kept for existing screens. */
  role: StaffRole | null;
  /** Every persona assigned to this login. */
  personas: Persona[];
  /** Every feature key unlocked by those personas. */
  permissions: string[];
  can: (permission: PermissionKey) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  loading: true,
  session: null,
  user: null,
  profile: null,
  role: null,
  personas: [],
  permissions: [],
  can: () => false,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadStaff(userId: string) {
    const [{ data: prof }, { data: roles }, { data: perms }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, specialty, hospital, unit").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.rpc("my_permissions"),
    ]);
    setProfile((prof as Profile) ?? null);
    const list = (roles ?? []).map((r) => r.role as Persona);
    setPersonas(list);
    setPermissions((perms ?? []).map((p) => p.permission_key as string));
    // A login can hold several personas (e.g. doctor + admin); the clinical one wins.
    const resolved = (["doctor", "nurse"] as StaffRole[]).find((r) => list.includes(r)) ?? null;
    setRole(resolved);
  }

  function clearStaff() {
    setProfile(null);
    setRole(null);
    setPersonas([]);
    setPermissions([]);
  }

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED" && event !== "INITIAL_SESSION")
        return;
      setSession(next);
      if (next?.user) {
        void loadStaff(next.user.id).finally(() => setLoading(false));
      } else {
        clearStaff();
        setLoading(false);
      }
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) await loadStaff(data.session.user.id);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    loading,
    session,
    user: session?.user ?? null,
    profile,
    role,
    personas,
    permissions,
    can: (permission) => permissions.includes(permission),
    refresh: async () => {
      if (session?.user) await loadStaff(session.user.id);
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setSession(null);
      clearStaff();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
