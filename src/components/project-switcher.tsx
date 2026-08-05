"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { ACTIVE_PROJECT_COOKIE } from "@/lib/config";
import type { ProjectDTO } from "@/lib/types";
import { CreateProjectPopover } from "@/components/create-project-popover";

/**
 * Project switcher — the multi-project control. Selecting a project rewrites
 * the current URL's `?project=KEY` query param and lets the server component
 * re-render with the new scope; it only changes which project you're looking
 * at. The switcher ALWAYS renders, even with zero or one project, so a fresh
 * install has a visible way to create and switch projects.
 *
 * The "+" button opens the shared create-project popover. On success the
 * page re-scopes to the new project — same URL rewrite as a switch,
 * preserving sibling query params — which also re-renders the list with the
 * new project in it.
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
  const [creating, setCreating] = useState(false);

  const goTo = (key: string) => {
    // Persist the choice (sticky project) so scope survives navigation to
    // param-less URLs; server actions also write this cookie on mutations.
    document.cookie = key
      ? `${ACTIVE_PROJECT_COOKIE}=${key}; path=/; max-age=31536000; samesite=lax`
      : `${ACTIVE_PROJECT_COOKIE}=; path=/; max-age=0`;
    const next = new URLSearchParams(params.toString());
    if (key) next.set("project", key);
    else next.delete("project");
    const qs = next.toString();
    // Preserve the current pathname (works for /, /map, /frontier, /new).
    const path = window.location.pathname;
    router.push(qs ? `${path}?${qs}` : path);
  };

  const close = () => setCreating(false);

  return (
    <div className="relative flex items-center gap-2">
      <label className="text-xs text-[--foreground-muted]">Project</label>
      <select
        value={activeKey ?? ""}
        onChange={(e) => goTo(e.target.value)}
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
      <button
        type="button"
        aria-label="New project"
        title="New project"
        onClick={() => (creating ? close() : setCreating(true))}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[--border] bg-[--surface-2]/70 text-[--foreground-muted] backdrop-blur-sm cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-[--foreground] hover:border-[--accent]"
      >
        <Plus size={14} />
      </button>

      {creating && (
        <CreateProjectPopover
          className="right-0"
          onClose={close}
          onCreated={(p) => {
            close();
            goTo(p.key);
          }}
        />
      )}
    </div>
  );
}
