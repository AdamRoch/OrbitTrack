"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ProjectDTO } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/**
 * Inline create-project popover, shared by the project switcher and the
 * new-ticket form's project picker. Posts to `POST /api/projects` (key:
 * 1–10 ASCII letters, stored uppercased; name optional, defaults to the
 * key). What happens on success is the caller's choice via `onCreated`:
 * the switcher re-scopes the page to the new project, the picker merely
 * selects it — navigating away would lose a half-written ticket.
 *
 * Renders its own click-away backdrop and closes on Escape / Cancel via
 * `onClose`. The panel is absolutely positioned (anchor with `className`),
 * so the parent needs `relative`.
 */
export function CreateProjectPopover({
  onCreated,
  onClose,
  className,
}: {
  onCreated: (project: ProjectDTO) => void;
  onClose: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const key = String(data.get("key") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(name ? { key, name } : { key }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not create project.");
        return;
      }
      onCreated(body as ProjectDTO);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className={cn(
          "glass absolute top-full z-50 mt-2 w-72 rounded-2xl p-4",
          className,
        )}
      >
        <h2 className="eyebrow mb-3">New project</h2>
        <form
          onSubmit={onCreate}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          className="space-y-3"
        >
          <Field label="Key">
            <Input
              name="key"
              placeholder="ORBT"
              required
              maxLength={10}
              pattern="[A-Za-z]{1,10}"
              title="1–10 letters; becomes the ticket prefix"
              autoFocus
              className="h-9 font-mono uppercase"
            />
          </Field>
          <Field label="Name (optional)">
            <Input
              name="name"
              placeholder="Defaults to the key"
              className="h-9"
            />
          </Field>
          {error && <p className="text-xs text-[--danger]">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
