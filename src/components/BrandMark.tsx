import logoUrl from "@/assets/virtualis-logo.png";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  /** Logo size in px. */
  size?: number;
  /** Hide the "Virtualis Consult" wordmark and show only the mark. */
  iconOnly?: boolean;
  className?: string;
  labelClassName?: string;
}

/** Virtualis brand lockup — the pixel-V mark plus the product wordmark. */
export function BrandMark({
  size = 28,
  iconOnly = false,
  className,
  labelClassName,
}: BrandMarkProps) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <img
        src={logoUrl}
        alt="Virtualis"
        width={size}
        height={size}
        className="rounded-[0.4rem] object-contain"
        style={{ width: size, height: size }}
      />
      {!iconOnly && (
        <span className={cn("font-semibold tracking-tight text-foreground", labelClassName)}>
          Virtualis <span className="text-primary">Consult</span>
        </span>
      )}
    </span>
  );
}
