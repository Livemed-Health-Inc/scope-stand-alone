import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Row = {
  id: string;
  hospital: string;
  unit: string;
  room: string;
  note: string | null;
  created_at: string;
};

export function RoundingBoard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase
      .from("rounding_queue")
      .select("id, hospital, unit, room, note, created_at")
      .eq("status", "ready")
      .order("created_at", { ascending: true });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("rounding-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "rounding_queue" }, () => void load())
      .subscribe();
    const id = window.setInterval(() => void load(), 15000);
    return () => {
      window.clearInterval(id);
      void supabase.removeChannel(channel);
    };
  }, []);

  async function markDone(row: Row) {
    const { error } = await supabase
      .from("rounding_queue")
      .update({ status: "cleared", cleared_at: new Date().toISOString(), cleared_by: user?.id ?? null })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Room ${row.room} marked rounded`);
    void load();
  }

  const byHospital = rows.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.hospital] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="label-caps">Ready for rounding</p>
          <h2 className="text-2xl font-semibold tracking-tight">Rounding board</h2>
        </div>
        <Badge variant="outline" className="gap-1.5 border-primary/30 text-primary">
          <ClipboardList className="size-3.5" /> {rows.length} waiting
        </Badge>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading rounding board…</p>
      ) : rows.length === 0 ? (
        <div className="panel-surface p-10 text-center text-sm text-muted-foreground">
          No carts are flagged for rounding right now.
        </div>
      ) : (
        Object.entries(byHospital).map(([hospital, list]) => (
          <section key={hospital} className="space-y-2">
            <p className="label-caps">{hospital}</p>
            <ul className="flex flex-col gap-2">
              {list.map((r) => (
                <li key={r.id} className="panel-surface flex flex-wrap items-center gap-4 p-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-semibold text-primary">
                    {r.room}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Room {r.room}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.unit} · {r.note ?? "Ready for rounding"}
                    </p>
                    <p className="mt-1 text-[0.68rem] uppercase tracking-widest text-muted-foreground">
                      Flagged {new Date(r.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <Button variant="secondary" className="gap-2" onClick={() => markDone(r)}>
                    <CheckCircle2 className="size-4" /> Mark rounded
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
