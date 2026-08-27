import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BedDouble,
  FileText,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Shield,
  Stethoscope,
  User,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ensureStaffRecords } from "@/lib/staff";
import { personaLabel, type PermissionKey } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { ProductEmbed } from "@/components/ProductEmbed";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Your Virtualis products" },
      { name: "description", content: "Launch the Virtualis products your account has access to." },
      { property: "og:title", content: "Your Virtualis products" },
      { property: "og:description", content: "Launch the Virtualis products your account has access to." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Launcher,
});

type Product = {
  permission: PermissionKey;
  label: string;
  blurb: string;
  icon: typeof Stethoscope;
  to?: string;
  href?: string;
};

/** The four flagship products first, then the rest of the workspace. */
const PRODUCTS: Product[] = [
  {
    permission: "platform.telemedicine",
    label: "Telemedicine",
    blurb: "A/V consults with remote stethoscope exams and the physician waiting room.",
    icon: Stethoscope,
    to: "/doctor",
  },
  {
    permission: "platform.chat",
    label: "Virtualis Chat",
    blurb: "Secure clinical messaging with your care teams.",
    icon: MessageSquare,
    href: "https://virtualischat.com",
  },
  {
    permission: "platform.note",
    label: "Virtualis Note",
    blurb: "Ambient documentation and AI-assisted clinical notes.",
    icon: FileText,
    href: "https://virtualisnote.ai",
  },
  {
    permission: "platform.one",
    label: "Virtualis One",
    blurb: "The unified Virtualis workspace.",
    icon: LayoutGrid,
    href: "https://www.virtualischat.com",
  },
];

const EXTRAS: Product[] = [
  { permission: "platform.bedside", label: "Bedside view", blurb: "The nurse-side bedside station.", icon: BedDouble, to: "/nurse" },
  { permission: "tech.provision", label: "Activations", blurb: "Provision hospitals and devices.", icon: Wrench, to: "/tech" },
  { permission: "patient.dtc", label: "My visits", blurb: "Your virtual visits.", icon: User, to: "/patient" },
  { permission: "analytics.view", label: "Analytics", blurb: "Consult analytics and reporting.", icon: BarChart3, to: "/admin" },
  { permission: "admin.roles", label: "Admin console", blurb: "Manage people, personas and facilities.", icon: Shield, to: "/admin" },
];

function Launcher() {
  const { loading, user, profile, personas, permissions, signOut, refresh, can } = useAuth();
  const navigate = useNavigate();
  const bootstrapped = useRef(false);
  const [provisioning, setProvisioning] = useState(false);
  const [open, setOpen] = useState<Product | null>(null);

  // A freshly created account has no role row yet; provision the persona
  // chosen at sign-up, then re-read permissions so the launcher unlocks.
  useEffect(() => {
    if (loading || !user || personas.length > 0 || bootstrapped.current) return;
    bootstrapped.current = true;
    setProvisioning(true);
    void ensureStaffRecords(user)
      .then(() => refresh())
      .finally(() => setProvisioning(false));
  }, [loading, user, personas.length]);

  // Administrators land straight in the admin console.
  useEffect(() => {
    if (loading || provisioning || !user) return;
    if (can("admin.roles")) void navigate({ to: "/admin", replace: true });
  }, [loading, provisioning, user, permissions.length]);



  if (loading || provisioning) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Opening your workspace…
      </main>
    );
  }


  const seen = new Set<string>();
  const pick = (list: Product[]) =>
    list.filter((p) => {
      if (!can(p.permission)) return false;
      const key = p.to ?? p.href ?? p.label;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const products = pick(PRODUCTS);
  const extras = pick(EXTRAS);

  if (products.length + extras.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="panel-surface max-w-md space-y-4 p-6 text-center">
          <BrandMark size={30} labelClassName="text-base" />
          <h1 className="text-lg font-semibold">No workspace assigned yet</h1>
          <p className="text-sm text-muted-foreground">
            {personas.length
              ? `Your account holds the ${personas.map(personaLabel).join(", ")} persona, but it has no features enabled yet.`
              : "Your account hasn't been assigned a persona yet."}{" "}
            A LiveMed administrator can grant access.
          </p>
          <Button size="sm" onClick={() => void signOut().then(() => navigate({ to: "/auth", replace: true }))}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }

  const card = (p: Product) => {
    const Icon = p.icon;
    const body = (
      <>
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-base font-semibold">
            {p.label}
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{p.blurb}</p>
        </div>
      </>
    );
    const cls =
      "group flex items-center gap-4 rounded-2xl border border-border/70 bg-panel/70 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md";
    return p.to ? (
      <Link key={p.label} to={p.to} className={cls}>
        {body}
      </Link>
    ) : (
      <button key={p.label} type="button" className={cls} onClick={() => setOpen(p)}>
        {body}
      </button>
    );
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 py-8">
      <header className="flex items-center justify-between gap-4">
        <BrandMark size={30} labelClassName="text-base" />
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{profile?.full_name ?? user?.email}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOut().then(() => navigate({ to: "/auth", replace: true }))}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </header>

      <section className="mt-12 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pick a product to open — you're already signed in everywhere.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">{products.map(card)}</div>

        {extras.length > 0 ? (
          <>
            <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-muted-foreground">More of your workspace</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">{extras.map(card)}</div>
          </>
        ) : null}
      </section>

      <ProductEmbed
        product={open?.href ? { label: open.label, href: open.href } : null}
        onClose={() => setOpen(null)}
      />
    </main>
  );
}
