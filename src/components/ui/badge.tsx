import { cn } from "@/lib/cn";

/** Small pill/tag. Used for status and labels. */
export function Badge({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[--border] bg-[--surface-2]/70 px-2 py-0.5 text-xs font-medium backdrop-blur-sm",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
