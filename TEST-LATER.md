# Test later

Changes we skipped running the suite for (dev server was up; typecheck passed).
Run `npm test` with no dev server running when convenient.

## Default view = To Do + in-progress toggle (2026-07-28)

- `src/app/page.tsx` — list defaults to `status=todo`; `?status=` still
  overrides for any status. Check:
  - `/` shows only todo tickets.
  - `/?status=in_progress` shows only in-progress ones.
  - `?status=done` / `backlog` / `canceled` still work when typed manually.
  - Empty todo list in a project that has in-progress tickets shows a sane
    empty state ("No tickets yet. Create your first one." — confirm copy is
    acceptable).
- `src/components/filter-bar.tsx` — status select replaced by a toggle button:
  - Default view renders an "In progress" button; clicking navigates to
    `?status=in_progress` preserving priority/label/project params.
  - In the in-progress view the button reads "To do" and navigates back to `/`.
  - "Clear" only appears for priority/label filters now, and resets to the
    default todo view.
- `tests/ui-smoke.test.ts` — new test "list page defaults to todo tickets and
  toggles to in progress" plus the updated filter-control assertion have
  never been run; confirm they pass.
- Manual UI pass: button styling matches the old select pills (same
  `selectClass`), layout doesn't shift with the "View" label.

## Older uncommitted batch (ticket rename + create-project popover)

Also still unverified by a full suite run: the issue→ticket copy rename, the
create-project popover, and the always-rendered project switcher.
