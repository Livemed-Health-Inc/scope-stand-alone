import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import QRCode from "qrcode";
import { KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmNurseTotp, resetNurseTotp, startNurseTotp } from "@/lib/nurse-otp.functions";

type Nurse = { id: string; full_name: string; phone_e164: string | null; totp_confirmed_at: string | null };

function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const digits = t.replace(/[^\d]/g, "");
  if (t.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function UnitNurses({ siteId }: { siteId: string }) {
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ nurse: Nurse; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const start = useServerFn(startNurseTotp);
  const confirm = useServerFn(confirmNurseTotp);
  const reset = useServerFn(resetNurseTotp);

  async function load() {
    const { data } = await supabase
      .from("unit_nurses")
      .select("id, full_name, phone_e164, totp_confirmed_at")
      .eq("site_id", siteId)
      .eq("is_active", true)
      .order("full_name");
    setNurses((data ?? []) as Nurse[]);
  }
  useEffect(() => {
    void load();
  }, [siteId]);

  async function save() {
    if (!name.trim()) {
      toast.error("Enter the nurse's name.");
      return;
    }
    const phone_e164 = normalizePhone(phone);
    if (phone_e164 && !/^\+\d{10,15}$/.test(phone_e164)) {
      toast.error("Enter a valid mobile number.");
      return;
    }
    const row = { full_name: name.trim(), phone_e164 };
    const { error } = editing
      ? await supabase.from("unit_nurses").update(row).eq("id", editing)
      : await supabase.from("unit_nurses").insert({ ...row, site_id: siteId });
    if (error) {
      toast.error(error.message);
      return;
    }
    setName("");
    setPhone("");
    setEditing(null);
    void load();
  }

  async function remove(n: Nurse) {
    if (!window.confirm(`Remove ${n.full_name} from this unit?`)) return;
    await supabase.from("unit_nurses").update({ is_active: false }).eq("id", n.id);
    void load();
  }

  async function beginTotp(n: Nurse) {
    try {
      const r = await start({ data: { nurseId: n.id } });
      setSetup({ nurse: n, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }), secret: r.secret });
      setCode("");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start setup.");
    }
  }

  async function finishTotp() {
    if (!setup) return;
    const r = await confirm({ data: { nurseId: setup.nurse.id, code } });
    if (!r.ok) {
      toast.error(r.error ?? "Code didn't match.");
      return;
    }
    toast.success(`Authenticator set up for ${setup.nurse.full_name}`);
    setSetup(null);
    void load();
  }

  return (
    <div>
      <p className="label-caps">Unit nurses</p>
      <ul className="mt-1.5 space-y-1.5">
        {nurses.length === 0 && <li className="text-xs text-muted-foreground">No nurses yet — add who works on this unit.</li>}
        {nurses.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{n.full_name}</span>
            <span className="text-xs text-muted-foreground">{n.phone_e164 ?? "no mobile"}</span>
            {n.totp_confirmed_at ? <Badge variant="secondary">Authenticator</Badge> : null}
            {!n.phone_e164 && !n.totp_confirmed_at && <Badge variant="destructive">No sign-in method</Badge>}
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => void beginTotp(n)}>
                <KeyRound className="size-3.5" /> {n.totp_confirmed_at ? "Reset authenticator" : "Set up authenticator"}
              </Button>
              {n.totp_confirmed_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  title="Remove authenticator"
                  onClick={async () => {
                    await reset({ data: { nurseId: n.id } });
                    void load();
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                aria-label="Edit"
                onClick={() => {
                  setEditing(n.id);
                  setName(n.full_name);
                  setPhone(n.phone_e164 ?? "");
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7" aria-label="Remove" onClick={() => void remove(n)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input className="h-8 w-48" placeholder="Nurse full name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="h-8 w-44" placeholder="Mobile (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button size="sm" className="h-8 gap-1" onClick={() => void save()}>
          <Plus className="size-3.5" /> {editing ? "Save" : "Add nurse"}
        </Button>
        {editing && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setEditing(null);
              setName("");
              setPhone("");
            }}
          >
            Cancel
          </Button>
        )}
      </div>

      <Dialog open={!!setup} onOpenChange={(o) => !o && setSetup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authenticator for {setup?.nurse.full_name}</DialogTitle>
          </DialogHeader>
          {setup && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Have the nurse scan this with Google Authenticator, Microsoft Authenticator or similar, then enter the code it shows.
              </p>
              <img src={setup.qr} alt="Authenticator QR code" className="mx-auto rounded-md bg-card p-2" width={220} height={220} />
              <p className="break-all text-center font-mono text-xs text-muted-foreground">{setup.secret}</p>
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
              <Button className="w-full" disabled={code.length !== 6} onClick={() => void finishTotp()}>
                Confirm
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
