import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * Double-bezel (Doppelrand) card: an outer shell that reads like a machined
 * tray, wrapping an inner glass core with concentric radii. Use for the major
 * panels across the app so every surface shares one physical language.
 */
export function GlassCard({
  children,
  className,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass-bezel",
        glow && "shadow-[0_0_44px_-12px_rgba(var(--glow),0.5)]",
        className,
      )}
    >
      <div className="glass-core p-4 sm:p-5">{children}</div>
    </div>
  );
}
