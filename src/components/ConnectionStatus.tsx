import { useEffect, useState } from "react";
import { Wifi, WifiOff, Signal } from "lucide-react";

type NetInfo = { type: "wifi" | "cellular" | "unknown"; strength: number; online: boolean; label: string };

function readConnection(): NetInfo {
  if (typeof navigator === "undefined") {
    return { type: "unknown", strength: 3, online: true, label: "—" };
  }
  const nav = navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string; downlink?: number };
  };
  const conn = nav.connection;
  const effective = conn?.effectiveType ?? "4g";
  const strengthMap: Record<string, number> = { "slow-2g": 1, "2g": 1, "3g": 2, "4g": 4 };
  const raw = conn?.type;
  const type: NetInfo["type"] = raw === "cellular" ? "cellular" : raw === "wifi" ? "wifi" : "wifi";
  return {
    type,
    strength: strengthMap[effective] ?? 4,
    online: navigator.onLine,
    label: effective.toUpperCase(),
  };
}

export function ConnectionStatus() {
  const [info, setInfo] = useState<NetInfo>({ type: "wifi", strength: 4, online: true, label: "4G" });

  useEffect(() => {
    const update = () => setInfo(readConnection());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const nav = navigator as Navigator & { connection?: EventTarget };
    nav.connection?.addEventListener?.("change", update);
    const id = window.setInterval(update, 8000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      nav.connection?.removeEventListener?.("change", update);
      window.clearInterval(id);
    };
  }, []);

  const bars = [1, 2, 3, 4];
  const good = info.online && info.strength >= 3;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel/70 px-3 py-2">
      {info.online ? (
        info.type === "cellular" ? (
          <Signal className="size-4 text-primary" />
        ) : (
          <Wifi className="size-4 text-primary" />
        )
      ) : (
        <WifiOff className="size-4 text-destructive" />
      )}
      <div className="flex items-end gap-[3px]" aria-hidden>
        {bars.map((b) => (
          <span
            key={b}
            className={`w-[3px] rounded-sm transition-colors ${
              info.online && b <= info.strength
                ? good
                  ? "bg-success"
                  : "bg-warning"
                : "bg-muted"
            }`}
            style={{ height: `${4 + b * 3}px` }}
          />
        ))}
      </div>
      <div className="leading-tight">
        <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-muted-foreground">
          {info.type === "cellular" ? "Cellular" : "Wi-Fi"}
        </p>
        <p className="text-xs font-medium text-foreground">
          {info.online ? `Connected · ${info.label}` : "Offline"}
        </p>
      </div>
    </div>
  );
}
