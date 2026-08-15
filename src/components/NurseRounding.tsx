import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceToken, type DeviceContext } from "@/lib/device";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type Entry = { id: string; room: string; note: string | null; status: string; created_at: string };

export function NurseRounding({ device }: { device: DeviceContext }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [room, setRoom] = useState("");
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const token = getDeviceToken();
    if (!token) return;
    const { data } = await supabase.rpc("device_rounding", { _device_token: token });
    setEntries((data ?? []) as Entry[]);
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, []);

  async function submit() {
    const token = getDeviceToken();
    if (!token) {
      toast.error("This device is no longer registered.");
      return;
    }
    if (!room.trim()) {
      toast.warning("Enter the room number for this cart.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("mark_rounding_ready", {
      _device_token: token,
      _room: room.trim(),
      ...(note.trim() ? { _note: note.trim() } : {}),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Room ${room.trim()} flagged as ready for rounding`);
    setRoom("");
    setNote("");
    setReady(false);
    void load();
  }

  async function clear(id: string) {
    const token = getDeviceToken();
    if (!token) return;
    await supabase.rpc("clear_rounding", { _device_token: token, _id: id });
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="panel-surface space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <ClipboardCheck className="size-5" />
          </div>
          <div>
            <p className="font-medium">Flag this cart for rounding</p>
            <p className="text-sm text-muted-foreground">
              {device.hospital} · {device.unit}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rounding-room">Room #</Label>
            <Input
              id="rounding-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="412-B"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rounding-note">Note (optional)</Label>
            <Input
              id="rounding-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Post-op day 2, cart at bedside"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-panel/60 p-3">
          <Checkbox checked={ready} onCheckedChange={(v) => setReady(v === true)} />
          <span className="text-sm font-medium">This cart is ready for rounding</span>
        </label>

        <Button onClick={submit} disabled={!ready || busy} className="gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
          Mark ready
        </Button>
      </div>

      <div>
        <p className="label-caps mb-2">Ready on this cart</p>
        {entries.length === 0 ? (
          <div className="panel-surface p-6 text-center text-sm text-muted-foreground">
            No rooms flagged for rounding yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li key={e.id} className="panel-surface flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Room {e.room}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.note ?? "Ready for rounding"} · {new Date(e.created_at).toLocaleTimeString()}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => clear(e.id)}>
                  <X className="size-4" /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
