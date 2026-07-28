"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { IssueStatus, Priority } from "@/lib/db/schema";
import type { LabelDTO } from "@/lib/types";
import { cn } from "@/lib/cn";
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from "./issue-display";

/**
 * Filter bar for the ticket list. A small client component so controls can
 * auto-navigate on change (preserving sibling filters). Each change rewrites
 * the URL query params, which re-renders the server component list.
 *
 * Status is one control: a dropdown with every status plus "Any"
 * (?status=all). Hovering (or keyboard-focusing) the dropdown reveals the
 * two most common picks — To Do (the default, clears the param) and In
 * Progress — as quick buttons floating beneath it, so the bar stays quiet
 * until you reach for it.
 */
export function FilterBar({
  labels,
  current,
}: {
  labels: LabelDTO[];
  current: { status?: IssueStatus; priority?: Priority; label?: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hasFilters = Boolean(
    current.priority ||
      current.label ||
      (current.status && current.status !== "todo"),
  );

  const navigate = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : "/");
  };

  const selectClass =
    "h-9 rounded-full border border-[--border] bg-[--surface-2]/70 px-3 text-sm text-[--foreground] backdrop-blur-sm focus:outline-none focus:border-[--accent] cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]";

  const quickClass = (active: boolean) =>
    cn(
      "h-7 rounded-full border px-2.5 text-xs backdrop-blur-sm cursor-pointer transition-colors",
      active
        ? "border-[--accent] bg-[--surface-2]/90 text-[--foreground]"
        : "border-[--border] bg-[--surface-2]/90 text-[--foreground-muted] hover:text-[--foreground] hover:border-[--accent]",
    );

  return (
    <div className="glass glow-edge flex flex-wrap items-end gap-3 mb-5 rounded-2xl p-3">
      <div className="group relative flex flex-col gap-1">
        <label className="text-xs text-[--foreground-muted]">Status</label>
        <select
          className={selectClass}
          value={current.status ?? "all"}
          onChange={(e) => {
            const v = e.target.value;
            navigate({ status: v === "todo" ? undefined : v });
          }}
        >
          <option value="all">Any</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Quick picks for the two most common statuses. Hidden until the
            control is hovered or focused (focus-within keeps it keyboard-
            accessible); absolutely positioned so nothing reflows. */}
        <div className="invisible absolute left-0 top-full z-10 mt-1 flex gap-1 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => navigate({ status: undefined })}
            className={quickClass(current.status === "todo")}
          >
            To do
          </button>
          <button
            type="button"
            onClick={() => navigate({ status: "in_progress" })}
            className={quickClass(current.status === "in_progress")}
          >
            In progress
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[--foreground-muted]">Priority</label>
        <select
          className={selectClass}
          value={current.priority !== undefined ? String(current.priority) : ""}
          onChange={(e) =>
            navigate({ priority: e.target.value || undefined })
          }
        >
          <option value="">Any</option>
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[--foreground-muted]">Label</label>
        <select
          className={selectClass}
          value={current.label ?? ""}
          onChange={(e) => navigate({ label: e.target.value || undefined })}
        >
          <option value="">Any</option>
          {labels.map((l) => (
            <option key={l.id} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => router.push("/")}
          className="h-9 px-3 inline-flex items-center text-sm text-[--foreground-muted] rounded-full hover:text-[--foreground] hover:bg-[--surface-hover] transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
