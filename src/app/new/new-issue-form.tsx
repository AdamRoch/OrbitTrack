"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createIssueAction } from "@/app/actions";
import { Field, Input, Textarea, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/components/issue-display";
import type { LabelDTO, ProjectDTO } from "@/lib/types";
import { SYSTEM_LABEL_NAME } from "@/lib/config";
import { CometIcon } from "@/components/icons";
import { CreateProjectPopover } from "@/components/create-project-popover";

/** Sentinel option value in the project picker that opens the create popover. */
const NEW_PROJECT = "__new__";

/**
 * New-issue form. Uses React 19's useActionState with the createIssue server
 * action so we get inline error display without client-side validation logic.
 *
 * The Project picker chooses which project (and thus prefix) the ticket is
 * created under; it posts as the `projectKey` form field. It's a plain
 * client-side field seeded from the URL scope — scope governs viewing, the
 * picker governs creation — so changing it re-renders nothing else and loses
 * no form state. The "+ New project…" option opens the shared create-project
 * popover; on success the new project is appended to the list and selected
 * in place (no navigation, so a half-written ticket survives).
 */
export function NewIssueForm({
  labels,
  projects,
  projectKey,
}: {
  labels: LabelDTO[];
  projects: ProjectDTO[];
  projectKey: string | null;
}) {
  const [state, formAction] = useActionState(createIssueAction, { ok: true });
  const [projectList, setProjectList] = useState(projects);
  const [selectedKey, setSelectedKey] = useState(
    projectKey ?? projects[0]?.key ?? "",
  );
  const [creatingProject, setCreatingProject] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && state.error && (
        <div className="rounded-xl border border-[--danger]/50 bg-[--danger]/10 px-3 py-2 text-sm text-[--danger]">
          {state.error}
        </div>
      )}

      <Field label="Project">
        <div className="relative">
          <Select
            name="projectKey"
            value={selectedKey}
            onChange={(e) => {
              if (e.target.value === NEW_PROJECT) {
                setCreatingProject(true);
              } else {
                setSelectedKey(e.target.value);
              }
            }}
          >
            {projectList.length === 0 && (
              <option value="" disabled>
                No projects yet
              </option>
            )}
            {projectList.map((p) => (
              <option key={p.id} value={p.key}>
                {p.key} — {p.name}
              </option>
            ))}
            <option value={NEW_PROJECT}>+ New project…</option>
          </Select>
          {creatingProject && (
            <CreateProjectPopover
              className="left-0"
              onClose={() => setCreatingProject(false)}
              onCreated={(p) => {
                setProjectList((list) => [...list, p]);
                setSelectedKey(p.key);
                setCreatingProject(false);
              }}
            />
          )}
        </div>
      </Field>

      <Field label="Title">
        <Input
          name="title"
          placeholder="What needs to be done?"
          autoFocus
          required
        />
      </Field>

      <Field label="Description (markdown)">
        <Textarea
          name="description"
          placeholder="Optional. Markdown is supported in the detail view."
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Status">
          <Select name="status" defaultValue="todo">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Priority">
          <Select name="priority" defaultValue="2">
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {labels.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-[--foreground-muted] mb-1.5">
            Labels
          </label>
          <div className="flex flex-wrap gap-2 rounded-xl border border-[--border] bg-[--surface-2]/60 p-3 backdrop-blur-sm">
            {labels
              .filter((l) => l.name.toLowerCase() !== SYSTEM_LABEL_NAME)
              .map((l) => (
              <label
                key={l.id}
                className="inline-flex items-center gap-1.5 text-sm text-[--foreground] cursor-pointer"
              >
                <input type="checkbox" name="labelNames" value={l.name} />
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" variant="primary" icon={<CometIcon className="h-3.5 w-3.5" />}>
          Create ticket
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
