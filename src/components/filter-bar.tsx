"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { IssueStatus, Priority } from "@/lib/db/schema";
import type { LabelDTO } from "@/lib/types";
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from "./issue-display";

/**
 * Filter bar for the ticket list. A small client component so controls can
 * auto-navigate on change (preserving sibling filters). Each change rewrites
 * the URL query params, which re-renders the server component list.
 *
 * Status gets two controls writing the same `status` param: a quick toggle
 * button for the common To Do (default) ↔ In Progress swap, and a full
 * dropdown for every status plus "Any" (?status=all). Picking To Do in the
 * dropdown clears the param — To Do is the default, so the URL stays clean.
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
  const viewingInProgress = current.status === "in_progress";

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

  return (
    <div className="glass glow-edge flex flex-wrap items-end gap-3 mb-5 rounded-2xl p-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-[--foreground-muted]">View</label>
        <button
          type="button"
          onClick={() =>
            navigate({ status: viewingInProgress ? undefined : "in_progress" })
          }
          className={selectClass}
        >
          {viewingInProgress ? "To do" : "In progress"}
        </button>
      </div>

      <div className="flex flex-col gap-1">
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
