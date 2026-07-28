# Test later

Changes we skipped running the suite for (dev server was up; typecheck passed).
Run `npm test` with no dev server running when convenient.

## Default view = To Do + status controls (2026-07-28)

- `src/app/page.tsx` — list defaults to `status=todo`; `?status=` overrides
  with any status, `?status=all` means no status filter. Check:
  - `/` shows only todo tickets.
  - `/?status=in_progress` shows only in-progress ones.
  - `/?status=all` shows everything; `?status=done` / `backlog` / `canceled`
    work too.
  - Empty todo list in a project that has other tickets shows a sane empty
    state ("No tickets yet. Create your first one." — confirm copy is
    acceptable).
- `src/components/filter-bar.tsx` — two controls share the `status` param:
  - Toggle button: default view renders "In progress" (→ `?status=in_progress`,
    preserving priority/label/project params); in that view it reads "To do"
    and navigates back to `/`.
  - Status dropdown: "Any" + every status; reflects the current view
    (`current.status ?? "all"`); picking To Do clears the param (default).
  - "Clear" appears for priority/label filters or a non-default status, and
    resets to the default todo view.
- `tests/ui-smoke.test.ts` — the toggle/default-view test (incl. `?status=all`)
  and the updated filter-control assertions have never been run; confirm they
  pass.
- Manual UI pass: button and dropdown pills align ("View" / "Status" labels),
  no layout shift.

## Older uncommitted batch (ticket rename + create-project popover)

Also still unverified by a full suite run: the issue→ticket copy rename, the
create-project popover, and the always-rendered project switcher.
