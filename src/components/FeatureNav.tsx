import { useEffect, useState } from "react";
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
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { createSsoHandoff } from "@/lib/sso.functions";
import type { PermissionKey } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  // Single sign-on hand-off: the digital front door has already authenticated
  // the user, so we pass the live session through to the embedded product plus
  // a one-time hand-off code it can exchange at /api/public/sso for the same
  // identity, roles and permissions — no second login prompt anywhere.
  useEffect(() => {
    let cancelled = false;
    if (!open?.href) {
      setEmbedUrl(null);
      return;
    }
    void (async () => {
      // Use a freshly refreshed session so the embedded product never receives
      // an about-to-expire token.
      let session = (await supabase.auth.getSession()).data.session;
      if (session && (session.expires_at ?? 0) * 1000 - Date.now() < 5 * 60_000) {
        session = (await supabase.auth.refreshSession()).data.session ?? session;
      }
      if (cancelled) return;
      const url = new URL(open.href!);
      const s = session;
      if (s?.access_token && s.refresh_token) {
        url.searchParams.set("sso", "virtualis");
        url.searchParams.set("sso_issuer", window.location.origin);
        url.searchParams.set("sso_exchange", `${window.location.origin}/api/public/sso`);
        url.searchParams.set("sso_identity", `${window.location.origin}/api/public/identity`);
        // Identity claims let the receiving product auto-provision the account
        // on first hand-off instead of prompting for a login.
        if (s.user?.email) url.searchParams.set("sso_email", s.user.email);
        if (s.user?.id) url.searchParams.set("sso_uid", s.user.id);
        try {
          const { code } = await createSsoHandoff({ data: { product: open.label } });
          if (cancelled) return;
          url.searchParams.set("sso_code", code);
        } catch {
          // Fall back to the session hand-off below if the code cannot be issued.
        }
        const hash = new URLSearchParams({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_in: String(s.expires_in ?? 3600),
          expires_at: String(s.expires_at ?? ""),
          token_type: s.token_type ?? "bearer",
          type: "magiclink",
        });
        url.hash = hash.toString();
      }
      setEmbedUrl(url.toString());
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);




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

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="h-[85vh] max-w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="text-sm">{open?.label}</DialogTitle>
          </DialogHeader>
          <div className="h-full w-full bg-background">
            {embedUrl ? (
              <iframe
                key={embedUrl}
                src={embedUrl}
                title={open?.label ?? "Feature"}
                className="h-full w-full border-0"
                allow="camera; microphone; clipboard-write; fullscreen"
              />
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Opening {open?.label}…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
