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
- `src/components/filter-bar.tsx` — status is one control now: a dropdown
  with "Any" + every status. Hovering or keyboard-focusing it reveals To do /
  In progress quick-pick buttons floating beneath (absolute, no reflow;
  `group-hover` + `group-focus-within`). Check:
  - Quick picks appear on hover AND on keyboard focus of the select.
  - The active quick pick is highlighted (To do highlighted by default).
  - The floating panel isn't clipped by the `.glass` filter bar (overflow).
  - ~~Tooltip hidden behind the ticket list~~ — fixed 2026-07-28, then
    RE-fixed same day: the bar's `relative z-20` wasn't enough because each
    `<Reveal>` sets `will-change: transform` (a permanent stacking context)
    and the ticket-panel Reveal comes later in DOM order. Real fix: the
    FilterBar's `<Reveal>` in page.tsx carries `relative z-20`. Verify the
    `?` cheat sheet AND quick picks paint above the first ticket card even
    after the reveal animations finish.
  - Dropdown "Any" → `?status=all`; picking To Do clears the param.
  - "Clear" appears for priority/label filters or a non-default status, and
    resets to the default todo view.
  - Touch device: no hover — quick picks unreachable, but the select alone
    must still be fully usable.
- Keyboard shortcuts (single keys, no modifiers) on `/` only:
  - `a` → ?status=all, `t` → default To Do, `i` → in_progress, `d` → done,
    `b` → backlog, `c` → canceled.
  - Ignored while focus is in an input/textarea/select/contenteditable, and
    when Ctrl/Cmd/Alt is held (browser + OS shortcuts untouched).
  - Discoverability: `?` chip at the right of the filter bar opens a cheat
    sheet on hover/focus; quick picks show their key (`t`, `i`).
  - Manual check: shortcuts navigate and preserve sibling params; typing in
    the new-ticket form is unaffected (FilterBar doesn't render there, but
    verify the guard anyway by focusing the label select and pressing keys).
- `tests/ui-smoke.test.ts` — the toggle/default-view test (incl. `?status=all`)
  and the updated filter-control assertions have never been run; confirm they
  pass.
- Manual UI pass: button and dropdown pills align ("View" / "Status" labels),
  no layout shift.

## New-ticket defaults + row status colors (2026-07-28)

- `src/app/new/new-issue-form.tsx` — Status default backlog → **todo**,
  Priority default 0 → **2 (Medium)**. Form-only; API defaults (omitted
  status/priority → backlog/0) are unchanged and still tested. Manual check:
  open /new, confirm both selects preselect To Do / Medium, create a ticket
  without touching them.
- `src/components/issue-display.tsx` — `IssueRow` gained a `statusStyle`
  prop (ROW_STATUS_STYLE). `/` passes it only for the mixed view
  (`?status=all`); `/frontier` is untouched. Manual check on `/?status=all`:
  - To Do rows: green left edge + faint green tint.
  - Done rows: darker green + check glyph before the identifier.
  - In Progress rows: indigo tint + small spinning glyph (and it animates).
  - Backlog: faded grey-green, slightly dimmed. Canceled: dimmed, no tint.
  - Filtered views (e.g. default To Do) show NO tint; frontier unchanged.
  - New `CheckIcon` in `src/components/icons.tsx`.
- Typecheck + eslint clean; full suite still pending (see header).

### Round 2 (same day): visibility + ordering feedback

- ROW_STATUS_STYLE v2 — user found v1 tints barely visible. Now: tint alpha
  ~0.15 (done 0.30), brighter hues (todo #4ade80, in_progress #7c8cff, done
  #1f7a54), and the identifier text itself is status-colored. Manual check:
  at a glance, all five statuses distinguishable on `/?status=all`.
- `src/app/page.tsx` — list now sorts by ticket number ascending
  (`issues.sort((a, b) => a.number - b.number)`), overriding the domain's
  priority-desc ordering for the page only; the REST API ordering is
  unchanged (tests/issues.test.ts pins it). Manual check: rows read
  LIN-1, LIN-2, … regardless of priority, in every filtered view too.

Also still unverified by a full suite run: the issue→ticket copy rename and
the always-rendered project switcher.

The create-project popover had a real bug (fixed 2026-07-28): it rendered a
`<form>` inside the new-ticket `<form>` on /new — invalid nested forms, so in
real browsers Create could swallow the submission and the project never
appeared in the picker. The popover is now a plain panel (click/Enter
handlers, no `<form>`), covered by `tests/new-issue-form.test.tsx` (jsdom).
Worth one manual browser pass: /new → picker → "+ New project…" → create via
both the Create button and Enter → confirm the project is appended + selected.

