# OrbitTrack

**An agent-native ticket tracker that enables autonomous, asynchronous, inter-harness collaboration.**

A local, no-auth issue tracker for driving agentic development. Issues with
status, priority, and labels plus a **dependency graph** and an **HTTP agent
API**. Multiple projects can be tracked side by side in one instance, each
with its own identifier prefix and per-project number sequence (`LIN-42`,
`OEMR-7`).

The highest-value capability is the **advisor relationship**: a cheap, fast
implementing agent works a ticket, and when it hits a decision it can't resolve
alone, it asks a question through the tracker. A smarter, more expensive advisor
agent reads the question with full issue context and answers it. The implementer
proceeds. You get expensive-model intelligence in your pipeline at the decision
points — not on every line of code.

Because the collaboration happens over HTTP, the two agents don't need to share
a harness. Pair them however you like:

- **GLM 5.2 in ZCode** implements via `/work-with-help`; **Claude Opus in Claude
  Code** advises via `/advise`. Neither harness knows the other exists — they
  communicate only through the tracker.
- **An OpenRouter-routed model** in one harness implements; a subscription-plan
  Claude Code session in another answers questions — programmatic collaboration
  across harnesses without an API key in the loop.

The real requirement isn't different harnesses — it's **separate processes with
no shared state**. Two sessions of the same harness, two terminals, two
machines: all structurally identical to the inter-harness case. The advisor
pattern earns its round-trip whenever the two agents would otherwise have no
channel between them. If they already share a session (a native sub-agent, a
shared context window), use that instead — OrbitTrack is pure overhead there.

Underneath the advisor layer sits the **frontier** — the set of issues an agent
can pick up next because they're `todo` and unblocked — and the dependency
graph that sequences work. Together they make the advisor pattern scale: an
implementer works a chain of tickets in blocking order, asking only when it
needs to, while the advisor answers asynchronously across whatever harness it
runs in.

Built with Next.js (App Router), SQLite (via Drizzle ORM + better-sqlite3), and
Tailwind. The whole tracker is one SQLite file.

## Why

For when you need Claude Code to communicate with an agent that lives in a
different harness — and you must use your Anthropic subscription.

OrbitTrack started from a concrete constraint: ZCode offers higher usage
allowances for GLM 5.2, but Claude Code is the only place to use an Anthropic
subscription. Both harnesses had value — but the two agents couldn't talk to
each other. Collaboration meant manually copying questions from one window and
pasting answers back to the other, acting as a human relay between agents that
should have been able to communicate directly.

OrbitTrack is that communication channel. Agents collaborate through a shared
tracker API instead of through the human.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. The database is created at `data/tracker.db` on
first run, seeded with four default labels (`ready-for-agent`, `bug`,
`feature`, `chore`), and bootstrapped with a default project whose key comes
from `TRACKER_PREFIX`. A pre-existing single-project database is migrated in
place on next start: its issues are backfilled into a default project keyed
off their existing identifier prefix (uppercased; `TRACKER_PREFIX` is only
used when the legacy DB holds no issues), and if it holds data, a timestamped
snapshot file is written next to the DB first.

### One-time setup / reset

- **Backup:** copy `data/tracker.db`.
- **Reset:** delete `data/tracker.db` (it's recreated on next start).

### Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `TRACKER_DB_PATH` | `data/tracker.db` | Location of the SQLite file. |
| `TRACKER_PREFIX` | `LIN` | Key of the default project bootstrapped on first run (stored uppercased; a project's key is its identifier prefix). Ignored when migrating a legacy DB that already has issues — their prefix wins (see above). Further projects are created via the API with their own keys. |
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

The tracker is **multi-project**: every `/api/issues/*` route takes an optional
`?project=KEY` query param selecting the project scope (the default project
when omitted), and `/api/projects` lists and creates projects. Identifier and
numeric lookups are scoped to the active project — an identifier from another
project is a `404`, never a leak.

The full route-by-route reference (paths, bodies, status codes, project
scoping) lives in [AGENTS.md](AGENTS.md), the agent-contract document loaded
into every agent session. It is the single source of truth for the API
surface; the tables are not duplicated here.

### Questions

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

Labels are **global across projects** — one triage vocabulary for the whole
tracker. CRUD lives at `/api/labels` (see [AGENTS.md](AGENTS.md)).

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

- **`/`** — issue list with status/priority/label filters and a project
  switcher; the list, frontier, and map pages are all scoped to the active
  project.
- **`/frontier`** — the frontier (what's grabbable right now).
- **`/map`** — the active project's dependency graph.
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

The tests cover: frontier cases, cycle/self-edge prevention, claim
transitions, identifier assignment (no reuse after delete), label cascade,
CRUD, filtering, the canonical error shape, multi-project scoping (per-project
numbering, no cross-project leakage), legacy single-project DB migration, plus
a few UI smoke checks.

---

## Project layout

```
src/
  lib/
    db/            schema + SQLite connection (lazy create + seed + legacy migration)
    domain.ts      the rules: frontier, cycle prevention, claim, CRUD, projects
    serialize.ts   canonical Issue JSON shape
    validate.ts    API input parsing → ValidationError
    identifiers.ts project-scoped :id resolution + KEY-N identifier format
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
