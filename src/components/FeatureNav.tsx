import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Stethoscope,
  MessageSquare,
  LayoutGrid,
  FileText,
  BedDouble,
  BarChart3,
  Shield,
  Wrench,
  User,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { PermissionKey } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ProductEmbed } from "@/components/ProductEmbed";

type Feature = {
  permission: PermissionKey;
  label: string;
  icon: typeof Stethoscope;
  /** internal route */
  to?: string;
  /** external product, opened in an in-app window */
  href?: string;
};

const FEATURES: Feature[] = [
  { permission: "platform.telemedicine", label: "Telemedicine", icon: Stethoscope, to: "/doctor" },
  { permission: "doctor.station", label: "Waiting room", icon: Stethoscope, to: "/doctor" },
  { permission: "platform.chat", label: "Virtualis Chat", icon: MessageSquare, href: "https://virtualischat.com" },
  { permission: "platform.one", label: "Virtualis One", icon: LayoutGrid, href: "https://www.virtualischat.com" },
  { permission: "platform.note", label: "Virtualis Note", icon: FileText, href: "https://virtualisnote.ai" },
  { permission: "platform.bedside", label: "Bedside view", icon: BedDouble, to: "/nurse" },
  { permission: "tech.provision", label: "Activations", icon: Wrench, to: "/tech" },
  { permission: "patient.dtc", label: "My visits", icon: User, to: "/patient" },
  { permission: "analytics.view", label: "Analytics", icon: BarChart3, to: "/admin" },
  { permission: "admin.roles", label: "Admin", icon: Shield, to: "/admin" },
];

export function FeatureNav({ className }: { className?: string }) {
  const { can } = useAuth();
  const [open, setOpen] = useState<Feature | null>(null);

  const seen = new Set<string>();
  const items = FEATURES.filter((f) => {
    if (!can(f.permission)) return false;
    const key = f.to ?? f.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (items.length < 2) return null;

  const base =
    "flex items-center gap-1.5 rounded-lg border border-border/70 bg-panel/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground";

  return (
    <>
      <nav className={cn("flex flex-wrap items-center gap-2", className)} aria-label="Your features">
        {items.map((f) => {
          const Icon = f.icon;
          return f.to ? (
            <Link
              key={f.label}
              to={f.to}
              className={base}
              activeProps={{ className: "border-primary/60 text-foreground bg-primary/10" }}
            >
              <Icon className="size-3.5" />
              {f.label}
            </Link>
          ) : (
            <button key={f.label} type="button" className={base} onClick={() => setOpen(f)}>
              <Icon className="size-3.5" />
              {f.label}
            </button>
          );
        })}
      </nav>

      <ProductEmbed
        product={open?.href ? { label: open.label, href: open.href } : null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
