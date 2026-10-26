import { useCallback, useEffect, useState } from "react";
import { Building2, Monitor, PhoneCall, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Station = {
  device_id: string;
  label: string;
  site_id: string;
  hospital: string;
  unit: string;
  online: boolean;
  busy: boolean;
};

export function MyStations({
  disabled,
  onPlaced,
}: {
  disabled: boolean;
  onPlaced: (call: { id: string; hospital: string; unit: string; label: string; mode: string }) => void;
}) {
  const [stations, setStations] = useState<Station[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_bedside_stations");
    setStations((data ?? []) as Station[]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(id);
  }, [load]);

  async function place(s: Station, mode: "call" | "drop_in") {
    const { data, error } = await supabase.rpc("doctor_call_device", { _device_id: s.device_id, _mode: mode });
    if (error || !data) {
      toast.error(error?.message ?? "Could not reach that bedside station");
      return;
    }
    onPlaced({ id: data as string, hospital: s.hospital, unit: s.unit, label: s.label, mode });
  }

  const groups = new Map<string, { hospital: string; unit: string; items: Station[] }>();
  stations.forEach((s) => {
    const g = groups.get(s.site_id) ?? { hospital: s.hospital, unit: s.unit, items: [] };
    g.items.push(s);
    groups.set(s.site_id, g);
  });

  return (
    <section className="space-y-3">
      <p className="label-caps">My hospitals</p>
      {loaded && groups.size === 0 && (
        <div className="panel-surface p-4 text-sm text-muted-foreground">
          You aren't assigned to any hospital with active bedside stations yet.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {[...groups.entries()].map(([id, g]) => (
          <div key={id} className="panel-surface space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <div>
                <p className="font-medium">{g.hospital}</p>
                <p className="text-xs text-muted-foreground">{g.unit}</p>
              </div>
            </div>
            <ul className="space-y-2">
              {g.items.map((s) => (
                <li key={s.device_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                  <Monitor className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{s.label}</span>
                  <Badge className={s.online ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}>
                    {s.busy ? "On a call" : s.online ? "Online" : "Offline"}
                  </Badge>
                  <Button size="sm" variant="secondary" className="gap-1" disabled={disabled || !s.online || s.busy} onClick={() => void place(s, "call")}>
                    <PhoneCall className="size-3.5" /> Call
                  </Button>
                  <Button size="sm" className="gap-1" disabled={disabled || !s.online || s.busy} onClick={() => void place(s, "drop_in")}>
                    <Eye className="size-3.5" /> Drop in
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
