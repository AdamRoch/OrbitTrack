"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import type { ProjectDTO } from "@/lib/types";

/**
 * Project switcher — the view-only multi-project control. Selecting a project
 * rewrites the current URL's `?project=KEY` query param and lets the server
 * component re-render with the new scope. The switcher does not mutate project
 * state; it only changes which project you're looking at.
 *
 * The control is rendered as a compact pill-style select to fit the existing
 * glass aesthetic. On change we preserve sibling query params (filters, etc.).
 */
export function ProjectSwitcher({
  projects,
  activeKey,
}: {
  projects: ProjectDTO[];
  activeKey: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  if (projects.length <= 1) return null;

  const onChange = (key: string) => {
    const next = new URLSearchParams(params.toString());
    if (key) next.set("project", key);
    else next.delete("project");
    const qs = next.toString();
    // Preserve the current pathname (works for /, /map, /frontier, /new).
    const path = window.location.pathname;
    router.push(qs ? `${path}?${qs}` : path);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-[--foreground-muted]">Project</label>
      <select
        value={activeKey ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-9 rounded-full border border-[--border] bg-[--surface-2]/70 px-3 text-sm text-[--foreground] backdrop-blur-sm focus:outline-none focus:border-[--accent] cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        )}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.key}>
            {p.key} — {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
