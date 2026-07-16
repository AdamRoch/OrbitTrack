# OrbitTrack

**An agent-native ticket tracker that enables autonomous, asynchronous, inter-harness collaboration.**

A local, no-auth issue tracker for driving agentic development. It's the 20% of
Linear that delivers 80% of the value: issues with status, priority, and labels
plus a **dependency graph** and an **HTTP agent API**. The single highest-value
capability is the **frontier** — the set of issues an agent can pick up next
because they're `todo` and unblocked.

Built with Next.js (App Router), SQLite (via Drizzle ORM + better-sqlite3), and
Tailwind. The whole tracker is one SQLite file.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. The database is created at `data/tracker.db` on
first run and seeded with four default labels (`ready-for-agent`, `bug`,
`feature`, `chore`).

### One-time setup / reset

- **Backup:** copy `data/tracker.db`.
- **Reset:** delete `data/tracker.db` (it's recreated on next start).

### Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `TRACKER_DB_PATH` | `data/tracker.db` | Location of the SQLite file. |
| `TRACKER_PREFIX` | `LIN` | Issue identifier prefix (`LIN-42`). |
| `TRACKER_SEED` | `true` | Set to `false` to skip seeding default labels. |

---

## The frontier

An issue is on the **frontier** when it is `todo` **and** every issue that
blocks it is `done`.

- `todo` = ready to be picked up, not started.
- `in_progress` = being worked (set via `claim`).
- `done` = complete; satisfies a blocking edge.
- `backlog` = captured but not committed to; never on the frontier.
- `canceled` = abandoned; **does not** satisfy a blocking edge — the dependent
  must be re-pointed or the edge removed.

Agents fetch the frontier, pick one, then claim it:

```bash
# What can I work on right now?
curl localhost:3000/api/issues/frontier

# Grab one atomically (todo → in_progress).
curl -X POST localhost:3000/api/issues/LIN-42/claim
```

The frontier is ordered by priority desc, then created asc (a long-waiting
ticket wins ties over a fresh one).

---

## Agent API

All routes are JSON in, JSON out. `:id` accepts either the numeric `id` or the
identifier string (e.g. `LIN-42`). Errors use a stable envelope:

```json
{ "error": { "message": "string", "code": "string | null" } }
```

### Issues

| Method | Path | Body | Success | Failure |
|---|---|---|---|---|
| `GET` | `/api/issues` | — | `200` `Issue[]`. Filters: `?status=`, `?priority=`, `?label=` (by name). | — |
| `GET` | `/api/issues/frontier` | — | `200` `Issue[]`. | — |
| `GET` | `/api/issues/:id` | — | `200` `Issue`. | `404` |
| `POST` | `/api/issues` | `{ title, description?, status?, priority?, labelNames?[] }` | `201` `Issue`. | `400` |
| `PATCH` | `/api/issues/:id` | partial of `{ title, description, status, priority }` | `200` `Issue`. | `400`, `404` |
| `POST` | `/api/issues/:id/claim` | — | `200` `Issue` (status `in_progress`). Idempotent if already `in_progress`. | `409` if not `todo`/`in_progress`; `404` |
| `DELETE` | `/api/issues/:id` | — | `204`. | `404` |
| `PUT` | `/api/issues/:id/labels` | `{ labelNames: string[] }` (full replacement) | `200` `Issue`. | `400` unknown name; `404` |
| `GET` | `/api/issues/:id/blockers` | — | `200` `Issue[]`. | `404` |
| `POST` | `/api/issues/:id/blockers` | `{ blockerId: number\|string }` | `201` `{ blockerIssueId, blockedIssueId }`. | `400` self-edge/cycle; `404` |
| `DELETE` | `/api/issues/:id/blockers/:blockerId` | — | `204`. | `404` |
| `GET` | `/api/issues/:id/questions` | — | `200` `Question[]` (also embedded in `Issue.questions`). | `404` |
| `POST` | `/api/issues/:id/questions` | `{ question }` | `201` `Question`. Requires `in_progress`. | `409 not_in_progress`; `400 empty`; `404` |
| `POST` | `/api/issues/:id/questions/:number/respond` | `{ answer }` | `200` `Question`. | `409 already_answered`; `400 empty`; `404` |

### Questions

| Method | Path | Body | Success | Failure |
|---|---|---|---|---|
| `GET` | `/api/questions` | — | `200` `{ issue: Issue, ...Question }[]`. Filters: `?status=open` (default), `?label=` (a QA-agent "track"). | `400 invalid_status` |

A **Question** is a clarification an implementing agent posts against an
`in_progress` issue, answered by a separate orchestrating model. It lets an
agent loop stay autonomous instead of stalling on a harness prompt.

- **Ask:** `POST /api/issues/:id/questions { question }`. Only while
  `in_progress` (claim runs first, so plan-time questions are covered). Numbers
  are a per-issue sequence (`Q1`, `Q2`, …).
- **Answer:** `POST /api/issues/:id/questions/:number/respond { answer }`.
  Answering is a single irreversible event — a second respond is `409`, not an
  overwrite. A correction is a new question (the next number).
- **State is derived:** `answeredAt == null` ⇒ `open`; otherwise `answered`.
  The full Q&A history is embedded in `Issue.questions`, so an implementing
  agent checks for an answer with one `GET /api/issues/:id` and an answering
  model reads prior exchanges as context.
- **Polling:** `GET /api/questions?status=open&label=auth` returns every open
  question across the issues in a track (issues sharing a label), each with its
  full `Issue` embedded. The orchestrator's wait strategy is polling; the
  tracker provides the data, the agent decides when to look.

### Labels

| Method | Path | Body | Success | Failure |
|---|---|---|---|---|
| `GET` | `/api/labels` | — | `200` `Label[]`. | — |
| `POST` | `/api/labels` | `{ name, color? }` | `201` `Label`. | `400` empty/dup/bad color |
| `DELETE` | `/api/labels/:id` | — | `204`. Removes from all issues. | `404` |

### `claim` semantics

The only mutator that performs a conditional status transition. An agent calls
`GET /api/issues/frontier`, picks one, then `POST /api/issues/:id/claim`. If two
agents race, both get `200` (single-user local app), but `409` is reserved for
the case where the issue is in a non-claimable state so the contract is
well-defined.

### Dependency direction (fixed)

A row `(blocker=A, blocked=B)` reads "**A blocks B**" / "**B is blocked by A**".
`POST /api/issues/B/blockers { blockerId: A }` creates that edge. The graph is
kept a DAG: self-edges and cycles are rejected at write time with `400`.

### Canonical `Issue` shape

```json
{
  "id": 123,
  "identifier": "LIN-123",
  "number": 123,
  "title": "string",
  "description": "markdown | null",
  "status": "todo",
  "priority": 2,
  "labels": [{ "id": 1, "name": "ready-for-agent", "color": "#22c55e" }],
  "blockerIssueIds": [122],
  "ready": false,
  "questions": [
    {
      "id": 1,
      "number": 1,
      "question": "should the cache be per-request or global?",
      "answer": "per-request — see the auth middleware.",
      "status": "answered",
      "createdAt": "2026-07-14T00:00:00.000Z",
      "answeredAt": "2026-07-14T00:05:00.000Z"
    }
  ],
  "createdAt": "2026-07-14T00:00:00.000Z",
  "updatedAt": "2026-07-14T00:00:00.000Z"
}
```

---

## UI

- **`/`** — issue list with status/priority/label filters.
- **`/frontier`** — the frontier (what's grabbable right now).
- **`/issues/:identifier`** — full detail: rendered markdown, edit form,
  status/priority/label controls, blocker + blocked-by lists with add/remove,
  and a read-only **Agent Q&A** transcript (open questions show as pending,
  answered ones as resolved — asking/answering are API-only).
- **`/new`** — create form.
- **`/labels`** — label CRUD.

The UI uses server actions (not the REST API) for mutations, but both go through
the same domain layer — so the rules (frontier, cycle prevention, claim,
identifier assignment, label cascade) are shared and identical.

---

## Testing

All behavior is tested through the REST API (the agent contract), against a real
Next.js instance with a fresh temp SQLite file per test file:

```bash
npm test          # run once
npm run test:watch
```

68 tests cover: frontier cases, cycle/self-edge prevention, claim transitions,
identifier assignment (no reuse after delete), label cascade, CRUD, filtering,
and the canonical error shape, plus a few UI smoke checks.

---

## Project layout

```
src/
  lib/
    db/            schema + SQLite connection (lazy create + seed)
    domain.ts      the rules: frontier, cycle prevention, claim, CRUD
    serialize.ts   canonical Issue JSON shape
    validate.ts    API input parsing → ValidationError
    identifiers.ts LIN-N assignment (persistent counter, never reused)
    api.ts         HTTP helpers + canonical error envelope
    markdown.ts    server-side remark rendering
  components/      UI primitives + shared issue display
  app/
    api/           REST route handlers (the agent contract)
    actions.ts     server actions (the UI's mutation seam)
    page.tsx       list view
    frontier/      frontier view
    issues/        detail view
    new/           create view
    labels/        label CRUD
tests/             black-box HTTP tests
```
