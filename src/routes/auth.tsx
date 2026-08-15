import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff Sign In — Virtualis Consult" },
      {
        name: "description",
        content: "Secure sign-in for nurses and physicians using the Virtualis remote stethoscope consult station.",
      },
      { property: "og:title", content: "Staff Sign In — Virtualis Consult" },
      {
        property: "og:description",
        content: "Secure sign-in for nurses and physicians using the Virtualis remote consult platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [staffRole, setStaffRole] = useState<"nurse" | "doctor">("doctor");
  const [fullName, setFullName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [unit, setUnit] = useState("ICU - 4 West");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function landing() {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return "/doctor" as const;
    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: uid });
    if (isAdmin) return "/admin" as const;
    const { data: isTech } = await supabase.rpc("is_tech", { _user_id: uid });
    if (isTech) return "/tech" as const;
    return "/doctor" as const;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    void navigate({ to: await landing() });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/doctor`,
        data: {
          full_name: fullName,
          staff_role: staffRole,
          specialty: staffRole === "doctor" ? specialty : null,
          unit,
        },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session) {
      void navigate({ to: "/doctor" });
    } else {
      toast.success("Check your email to confirm your account.");
    }
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/doctor" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-primary">
          <BrandMark size={34} labelClassName="text-lg" />
        </Link>

        <div className="panel-surface p-6">
          <h1 className="text-xl font-semibold">Staff access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nurses reach physicians instantly. Physicians go on-call from anywhere.
          </p>

          <Tabs defaultValue="signin" className="mt-5">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-3">
                <div>
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  Sign in
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-3">
                <div>
                  <Label>I am a</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {(["nurse", "doctor"] as const).map((r) => (
                      <Button
                        key={r}
                        type="button"
                        variant={staffRole === r ? "default" : "secondary"}
                        onClick={() => setStaffRole(r)}
                        className="capitalize"
                      >
                        {r === "doctor" ? "Physician" : "Nurse"}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    LiveMed administrator access is granted internally and cannot be requested here.
                  </p>

                </div>
                <div>
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                {staffRole === "doctor" ? (
                  <div>
                    <Label htmlFor="spec">Specialty</Label>
                    <Input
                      id="spec"
                      placeholder="Cardiology"
                      required
                      value={specialty}
                      onChange={(e) => setSpecialty(e.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="unit">Unit</Label>
                    <Input id="unit" required value={unit} onChange={(e) => setUnit(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label htmlFor="email2">Work email</Label>
                  <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="password2">Password</Label>
                  <Input
                    id="password2"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  Create account
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="secondary" className="w-full" onClick={google}>
            Continue with Google
          </Button>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Encrypted clinical session
          </p>
        </div>
      </div>
    </main>
  );
}
