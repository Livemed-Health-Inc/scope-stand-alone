import { useCallback, useEffect, useState } from "react";
import { Building2, Monitor, PhoneCall, Eye, ChevronDown, ChevronUp } from "lucide-react";
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

const PREF_KEY = "virtualis.mystations.collapsed";

export function MyStations({
  disabled,
  onPlaced,
}: {
  disabled: boolean;
  onPlaced: (call: { id: string; hospital: string; unit: string; label: string; mode: string }) => void;
}) {
  const [stations, setStations] = useState<Station[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  // Read the saved preference after mount so the server-rendered markup matches.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(PREF_KEY) === "1");
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PREF_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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

  const online = stations.filter((s) => s.online && !s.busy).length;
  const summary =
    groups.size === 0
      ? "No bedside stations assigned"
      : `${groups.size} ${groups.size === 1 ? "hospital" : "hospitals"} · ${stations.length} ${
          stations.length === 1 ? "cart" : "carts"
        } · ${online} available`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps">My hospitals</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-expanded={!collapsed}
          aria-controls="my-stations-list"
          onClick={toggle}
        >
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          {collapsed ? "Expand" : "Minimize"}
        </Button>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={toggle}
          className="panel-surface flex w-full flex-wrap items-center gap-3 p-3 text-left transition hover:border-primary/40"
        >
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Building2 className="size-4" />
          </div>
          <span className="min-w-0 flex-1 truncate text-sm">{summary}</span>
          {online > 0 && (
            <Badge className="bg-success/15 text-success">
              {online} {online === 1 ? "cart" : "carts"} available
            </Badge>
          )}
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            Expand <ChevronDown className="size-3.5" />
          </span>
        </button>
      ) : (
        <div id="my-stations-list" className="space-y-3">
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
                    <li
                      key={s.device_id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                    >
                      <Monitor className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{s.label}</span>
                      <Badge className={s.online ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}>
                        {s.busy ? "On a call" : s.online ? "Online" : "Offline"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1"
                        disabled={disabled || !s.online || s.busy}
                        onClick={() => void place(s, "call")}
                      >
                        <PhoneCall className="size-3.5" /> Call
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1"
                        disabled={disabled || !s.online || s.busy}
                        onClick={() => void place(s, "drop_in")}
                      >
                        <Eye className="size-3.5" /> Drop in
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
