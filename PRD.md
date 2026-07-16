# PRD — OrbitTrack

*An agent-native ticket tracker that enables autonomous, asynchronous, inter-harness collaboration.*

A local, single-user, no-auth issue tracker for managing tickets used to drive agentic development. The tracker is not a clone of Linear's collaboration features — it is the **core issue model plus a dependency graph and an HTTP agent API**. The highest-value capability is the **advisor relationship**: a cheap implementing agent works a ticket, and when it hits a decision it can't resolve alone, it asks a question through the tracker — a smarter advisor agent answers, and the implementer proceeds. You get expensive-model intelligence at the decision points, not on every line of code.

---

## Problem Statement

I want to manage my own tickets for agentic development without paying for Linear. I run coding agents against my work, and I need those agents to be able to read which ticket to do next and report status back. Commercial Linear is multiplayer-first; its cost and complexity come from collaboration, SSO, notifications, and integrations I do not need. As a single user on localhost, I want the 20% of Linear that delivers 80% of the value: issues with status, priority, labels, and blocking edges — plus a clean HTTP surface so agents can drive the tracker as their working memory.

---

## Solution

A local web application built with Next.js (App Router) backed by a single SQLite database file via Drizzle ORM. It runs on localhost with no authentication. The UI is functional and clean (Tailwind + shadcn/ui), not a pixel-clone of Linear's signature feel. Alongside the UI, a thin REST API exposes the same data so that CLI agent processes can list issues, read the frontier, create issues, claim a ticket, and update status. The data model is intentionally tiny: issues, labels, and a dependency graph.

---

## User Stories

### Issues — core
1. As a user, I want to create an issue with a title and an optional markdown description, so that I can capture work to be done.
2. As a user, I want each issue to receive a unique human-readable identifier (e.g. `LIN-42`) on creation, so that I can refer to it in conversation and commits.
3. As a user, I want to set an issue's status, so that I can track where work stands.
4. As a user, I want to set an issue's priority, so that I can communicate which work matters most.
5. As a user, I want to apply one or more labels to an issue, so that I can categorize it (e.g. `ready-for-agent`, `bug`).
6. As a user, I want to edit an issue's title, description, status, priority, and labels after creation, so that I can keep it current.
7. As a user, I want to delete an issue, so that I can remove mistakes or obsolete work.
8. As a user, I want to view a single issue's full detail (rendered description, status, priority, labels, blockers), so that I can understand the work.

### Issues — list & navigation
9. As a user, I want to see a list of all issues showing identifier, title, status, priority, and labels, so that I can survey the backlog.
10. As a user, I want to filter the issue list by status, so that I can focus on e.g. only `todo` issues.
11. As a user, I want to filter the issue list by label, so that I can find e.g. all `ready-for-agent` issues.
12. As a user, I want to filter the issue list by priority, so that I can surface urgent work.
13. As a user, I want the list to be sorted by a sensible default (priority desc, then created desc), so that the most important newest work is on top.

### Dependencies
14. As a user, I want to declare that one issue blocks another, so that I can sequence work.
15. As a user, I want to remove a blocking relationship, so that I can correct sequencing.
16. As a user, I want to see, on an issue's detail view, which issues block it, so that I know what must finish first.
17. As a user, I want to see, on an issue's detail view, which issues it blocks, so that I know what depends on it.
18. As a user, I want the system to prevent me from creating a dependency cycle (A→B→A), so that the graph stays a DAG.
19. As a user, I want the system to prevent an issue from blocking itself, so that the data stays sane.
20. As a user, I want to view the **frontier** — issues that are `todo` and whose every blocker is `done` — so that I (or an agent) can pick up work that is genuinely ready.

### Labels
21. As a user, I want to create a label with a name and a color, so that I can establish my triage vocabulary.
22. As a user, I want to list all labels, so that I can see my vocabulary.
23. As a user, I want to delete a label, so that I can retire vocabulary I no longer use. Deleting a label should remove it from all issues, not delete the issues.

### Agent API
24. As an agent, I want to call `GET /api/issues` with optional filters, so that I can discover work.
25. As an agent, I want to call `GET /api/issues/frontier`, so that I can find the next unblocked ready ticket to grab.
26. As an agent, I want to call `POST /api/issues`, so that I can create follow-up tickets during a task.
27. As an agent, I want to call `PATCH /api/issues/:id`, so that I can update status, priority, title, or description as I learn more.
28. As an agent, I want to call `POST /api/issues/:id/claim`, so that I can atomically move a `todo` issue to `in_progress` without races.
29. As an agent, I want to call `GET /api/issues/:id/blockers`, so that I can inspect what gates a ticket.
30. As an agent, I want to call `POST /api/issues/:id/blockers` and `DELETE /api/issues/:id/blockers/:blockerId`, so that I can maintain sequencing edges programmatically.
31. As an agent, I want all API responses to use JSON with consistent shapes, so that I can parse them reliably.
32. As an agent, I want errors to return a stable error shape with a message, so that I can react to failures.

### Lifecycle & data
33. As a user, I want my data stored in a single SQLite file on disk, so that I can back up, inspect, or reset the whole tracker by copying one file.
34. As a user, I want `created_at` and `updated_at` timestamps on issues, so that I can audit history at a glance.
35. As a user, I want the app to start with one command and run on localhost, so that there is zero ops burden.

---

## Implementation Decisions

### Stack
- **Framework:** Next.js (App Router), TypeScript. Server Components for list/detail reads; server actions or route handlers for mutations from the UI.
- **Database:** SQLite, accessed through **Drizzle ORM**. The database is a single file (e.g. `data/tracker.db`) committed-ignored; the app creates it on first run.
- **UI:** Tailwind CSS + shadcn/ui components. Functional and legible; no command palette, no keyboard-only navigation, no optimistic updates. Forms submit and the page reloads/refetches server-side.
- **Agent API:** A thin REST layer under `/api/*` implemented as Next.js Route Handlers. It is deliberately separate from any server-action UI mutations so that the agent contract is explicit and stable.
- **No auth, no users.** The app binds to localhost only. There is no notion of who created or claimed an issue beyond the status field.

### Identifier scheme
- Each issue gets a stable human-readable `identifier` of the form `<PREFIX>-<number>`, e.g. `LIN-42`.
- The prefix is a single configurable project constant (default `LIN`).
- The number is a project-wide auto-incrementing integer assigned atomically at creation (separate from the surrogate primary key `id`). It never changes and is never reused.

### Status — controlled vocabulary and state machine
Allowed values: `backlog`, `todo`, `in_progress`, `done`, `canceled`.

Canonical flow: `backlog → todo → in_progress → done`. `canceled` is a terminal state reachable from any non-terminal state. Transitions are **not** hard-restricted (any status may be set to any other) to keep the API forgiving, but the UI surfaces the canonical flow as the expected path.

Semantics for the frontier query:
- `todo` = ready to be picked up, not yet started.
- `in_progress` = actively being worked (set via `claim`).
- `done` = complete; satisfies a blocking edge.
- `backlog` = captured but not yet committed to; never on the frontier.
- `canceled` = abandoned; does **not** satisfy a blocking edge (a blocker that is canceled does not unblock its dependents — it must be re-pointed or the dependency removed).

### Priority — controlled vocabulary
An integer where higher = more urgent: `0` none, `1` low, `2` medium, `3` high, `4` urgent. Default on creation is `0`. The list view sorts priority descending.

### Data model (logical schema)

- **issues**: `id` (pk), `number` (unique, project-wide autoincrement), `identifier` (unique, derived `<PREFIX>-<number>`), `title` (non-empty), `description` (markdown text, nullable), `status` (enum, default `backlog`), `priority` (int, default 0), `created_at`, `updated_at`.
- **labels**: `id` (pk), `name` (unique, non-empty), `color` (hex color string).
- **issue_labels**: `issue_id`, `label_id` — composite pk; cascade delete on both sides.
- **dependencies**: `blocker_issue_id`, `blocked_issue_id` — composite pk; both reference `issues(id)`. A row asserts "the blocker issue must reach `done` before the blocked issue is considered ready."

**Dependency direction is fixed and explicit in the API:** row `(blocker=A, blocked=B)` reads "A blocks B" / "B is blocked by A". The frontier query for issue B checks that every issue A where `(A, B)` exists has `status = done`.

**Graph integrity (enforced at write time, at the API boundary):**
- Reject self-edges (`blocker = blocked`).
- Reject edges that would create a cycle (a depth-first reachability check before insert suffices since the graph stays small).
- Deleting an issue removes its dependency rows and its label associations (cascade). Dependent issues simply lose that edge.

### Issue JSON shape (canonical, returned by every API read)
```
{
  "id": 123,
  "identifier": "LIN-123",
  "number": 123,
  "title": "string",
  "description": "markdown | null",
  "status": "todo" | "backlog" | "in_progress" | "done" | "canceled",
  "priority": 0 | 1 | 2 | 3 | 4,
  "labels": [ { "id": 1, "name": "ready-for-agent", "color": "#22c55e" } ],
  "blockerIssueIds": [ 122, 121 ],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### Error JSON shape (canonical, every 4xx/5xx)
```
{ "error": { "message": "string", "code": "string | null" } }
```

### Agent API contract (exact)

All routes are JSON in, JSON out. `:id` accepts either the numeric `id` or the `identifier` string (e.g. `LIN-42`).

| Method | Path | Body | Success | Failure |
|---|---|---|---|---|
| `GET` | `/api/issues` | — | `200` `Issue[]`. Filters via query: `status`, `priority`, `label` (by name). | — |
| `GET` | `/api/issues/frontier` | — | `200` `Issue[]` — issues where `status=todo` AND (no blockers OR all blockers `done`), sorted priority desc then created asc. | — |
| `GET` | `/api/issues/:id` | — | `200` `Issue`. | `404` if not found. |
| `POST` | `/api/issues` | `{ title, description?, status?, priority?, labelNames?[] }` | `201` `Issue`. Defaults: status `backlog`, priority `0`. | `400` if title missing/empty or enum invalid. |
| `PATCH` | `/api/issues/:id` | partial of `{ title, description, status, priority }` | `200` `Issue`. | `400` invalid enum; `404` not found. |
| `POST` | `/api/issues/:id/claim` | — | `200` `Issue` with status set to `in_progress`. **Idempotent if already `in_progress`.** | `409` if status is not `todo` or `in_progress` (i.e. `backlog`, `done`, `canceled`). `404` not found. |
| `DELETE` | `/api/issues/:id` | — | `204`. | `404` not found. |
| `PUT` | `/api/issues/:id/labels` | `{ labelNames: string[] }` (full replacement) | `200` `Issue` with refreshed labels. Creating a label on the fly is **not** done here; unknown names return `400`. | `400` unknown label name; `404` issue not found. |
| `GET` | `/api/issues/:id/blockers` | — | `200` `Issue[]` of blocker issues. | `404` not found. |
| `POST` | `/api/issues/:id/blockers` | `{ blockerId: number\|string }` | `201` `{ blockerIssueId, blockedIssueId }`. | `400` self-edge or cycle; `404` either issue missing. |
| `DELETE` | `/api/issues/:id/blockers/:blockerId` | — | `204`. | `404` edge or issue missing. |
| `GET` | `/api/labels` | — | `200` `Label[]`. | — |
| `POST` | `/api/labels` | `{ name, color }` | `201` `Label`. | `400` empty name, bad color, or duplicate name. |
| `DELETE` | `/api/labels/:id` | — | `204`. Removes from all issues. | `404` not found. |

**`claim` semantics (load-bearing for agent loops):** the only mutator that performs a conditional status transition. An agent calls `GET /api/issues/frontier`, picks one, then `POST /api/issues/:id/claim`. If two agents race, both get `200` (single-user local app, no real concurrency expected) but the contract reserves `409` for the case where the issue is in a non-claimable state so the behavior is well-defined if it ever matters.

### UI views
1. **List view** (`/`) — table of all issues: identifier, title, status badge, priority, label chips. Filter controls for status/label/priority via query params. Links each row to the detail view.
2. **Frontier view** (`/frontier`) — same row format, restricted to frontier issues. This is the page an agent's human checks to see "what's grabbable right now."
3. **Detail view** (`/issues/:identifier`) — full title, rendered markdown description, status/priority controls, label chips, lists of blockers and blocked-by. Edit form (title, description, status, priority) and dependency add/remove controls.
4. **New issue** (`/new`) — form with title, description, status, priority, labels.

The UI and the API hit the same data layer; the UI is not required to call the REST endpoints (it may use server actions / direct data access). The **API is the stable contract for agents**; the UI is allowed to evolve freely.

---

## Testing Decisions

**One seam: the REST API.** All behavior — including the frontier query, cycle prevention, claim transitions, label management, and identifier assignment — is tested through HTTP requests against a real app instance backed by a fresh temp SQLite file per test. This is the highest useful seam because the API is also the agent contract: testing it directly tests the thing that has to be correct.

- A good test asserts on the JSON responses and the observable side effects of subsequent reads — never on internal function signatures, DB row counts as implementation details, or private helpers.
- **Frontier query gets dedicated tests** because it is the core logic. Cases: (a) issue with no blockers is on the frontier when `todo`; (b) issue with one `done` blocker is on the frontier; (c) issue with one `backlog`/`todo`/`in_progress`/`canceled` blocker is **not** on the frontier; (d) issue with multiple blockers is on the frontier only when all are `done`; (e) `backlog`/`in_progress` issues are never on the frontier regardless of blockers.
- **Cycle/self-edge prevention** gets a test: adding a cycle is rejected with `400`; self-edge rejected with `400`.
- **Claim transitions** get a test: `todo → in_progress` succeeds; `in_progress → in_progress` is idempotent; `backlog`, `done`, `canceled` yield `409`.
- **Identifier assignment** gets a test: two creates yield sequential numbers; deleted numbers are not reused.
- **Label delete cascade** gets a test: deleting a label removes it from issues but keeps the issues.

No dedicated UI tests are required beyond a couple of smoke checks that pages render with expected elements — the UI is thin and the data correctness is already covered at the API.

---

## Out of Scope

- Multi-user: accounts, auth, permissions, teams, mentions, notifications.
- Real-time / collaborative editing / presence.
- The signature Linear UX: command palette (⌘K), full keyboard navigation, optimistic updates, drag-and-drop reordering, rich animations.
- Projects, cycles, sprints, milestones, or any grouping above issues.
- Sub-issues / nested issues (dependencies cover sequencing).
- Roadmaps, timelines, Gantt views, insights/analytics.
- Integrations: Slack, GitHub, email, webhooks (beyond the HTTP API), Zapier.
- File attachments, image uploads, rich embeds.
- Comments / activity feed / history audit log (only `created_at`/`updated_at` are captured).
- Full-text search (filtering by status/label/priority is in scope; free-text search is not).
- Mobile-responsive design (desktop localhost only).
- Multi-device or hosted deployment.

---

## Further Notes

- **Why no projects/cycles:** for agent-driven work, the dependency graph + frontier query already encode sequencing. Grouping adds a layer of navigation without adding scheduling power. Add it later only if a real need appears.
- **Why `canceled` does not satisfy a blocking edge:** canceling a blocker usually means "we're not doing that" — the dependent should be re-examined, not silently unblocked. The user must explicitly remove the edge or re-point the dependent. (Revisit if this feels noisy in practice.)
- **The frontier is the product.** Every other feature exists to make the frontier accurate and useful. If a future decision would complicate or degrade the frontier query, prefer the frontier.
- **Backup story:** the entire tracker is one SQLite file. Copy it to back up; delete it to reset.
- **First run:** on startup, if the DB file is absent, create it and run migrations, then seed any default labels the user wants (suggested defaults: `ready-for-agent`, `bug`, `feature`, `chore`). Seeding is optional and configurable.
- **Extending later:** the API surface is small on purpose. New agent capabilities (e.g. posting progress notes, claiming with an agent id) can be added as new endpoints without disturbing existing ones.
