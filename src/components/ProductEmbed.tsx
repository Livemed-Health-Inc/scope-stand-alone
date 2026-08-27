import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createSsoHandoff } from "@/lib/sso.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ExternalProduct = {
  label: string;
  href: string;
};

/**
 * Builds the single sign-on URL for an external Virtualis product: the live
 * session plus a one-time hand-off code the product exchanges at
 * /api/public/sso — no second login prompt anywhere.
 */
async function buildSsoUrl(product: ExternalProduct): Promise<string> {
  // Use a freshly refreshed session so the embedded product never receives an
  // about-to-expire token.
  let session = (await supabase.auth.getSession()).data.session;
  if (session && (session.expires_at ?? 0) * 1000 - Date.now() < 5 * 60_000) {
    session = (await supabase.auth.refreshSession()).data.session ?? session;
  }
  const url = new URL(product.href);
  const s = session;
  if (!s?.access_token || !s.refresh_token) return url.toString();

  url.searchParams.set("sso", "virtualis");
  url.searchParams.set("sso_issuer", window.location.origin);
  url.searchParams.set("sso_exchange", `${window.location.origin}/api/public/sso`);
  url.searchParams.set("sso_identity", `${window.location.origin}/api/public/identity`);
  if (s.user?.email) url.searchParams.set("sso_email", s.user.email);
  if (s.user?.id) url.searchParams.set("sso_uid", s.user.id);
  try {
    const { code } = await createSsoHandoff({ data: { product: product.label } });
    url.searchParams.set("sso_code", code);
  } catch {
    // Fall back to the session hand-off below if the code cannot be issued.
  }
  url.hash = new URLSearchParams({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: String(s.expires_in ?? 3600),
    expires_at: String(s.expires_at ?? ""),
    token_type: s.token_type ?? "bearer",
    type: "magiclink",
  }).toString();
  return url.toString();
}

/**
 * Opens an external Virtualis product in an in-app window with the SSO
 * hand-off applied. Used by the feature nav and the post-login launcher.
 */
export function ProductEmbed({
  product,
  onClose,
}: {
  product: ExternalProduct | null;
  onClose: () => void;
}) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!product) {
      setEmbedUrl(null);
      return;
    }
    setEmbedUrl(null);
    void buildSsoUrl(product).then((url) => {
      if (!cancelled) setEmbedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [product]);

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="h-[85vh] max-w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-3 text-sm">
            {product?.label}
            {embedUrl ? (
              <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-normal text-muted-foreground underline hover:text-foreground"
              >
                Open in new tab
              </a>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <div className="h-full w-full bg-background">
          {embedUrl ? (
            <iframe
              key={embedUrl}
              src={embedUrl}
              title={product?.label ?? "Feature"}
              className="h-full w-full border-0"
              allow="camera; microphone; clipboard-write; fullscreen"
            />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Opening {product?.label}…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
