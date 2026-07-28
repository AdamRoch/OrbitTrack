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
 * Deliberately NOT a <form>: on /new the popover renders inside the
 * new-ticket form, and nested forms are invalid HTML — browsers handle them
 * inconsistently (the inner submit can be swallowed or misrouted), which is
 * why Create once did nothing there. A plain panel with an explicit handler
 * (click or Enter) behaves the same everywhere.
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
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    const k = key.trim();
    // No <form> means no native `required`/`pattern` enforcement — mirror
    // the server-side rule (parseProjectKey) so the feedback stays inline.
    if (!/^[A-Za-z]{1,10}$/.test(k)) {
      setError("Key must be 1–10 letters; it becomes the ticket prefix.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(name.trim() ? { key: k, name: name.trim() } : { key: k }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not create project.");
        return;
      }
      onCreated(body as ProjectDTO);
    } catch {
      setError("Could not create project.");
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
        onKeyDown={(e) => {
          // Enter = Create (preventDefault so it can't bubble into an
          // implicit submission of an ancestor form), Escape = close.
          if (e.key === "Enter") {
            e.preventDefault();
            onCreate();
          }
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="eyebrow mb-3">New project</h2>
        <div className="space-y-3">
          <Field label="Key">
            <Input
              placeholder="ORBT"
              maxLength={10}
              title="1–10 letters; becomes the ticket prefix"
              autoFocus
              className="h-9 font-mono uppercase"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
          <Field label="Name (optional)">
            <Input
              placeholder="Defaults to the key"
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {error && <p className="text-xs text-[--danger]">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={onCreate}
            >
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
