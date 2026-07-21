<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:tracker-integration -->
# Tracker — your work queue

This repo has a local issue tracker running at **http://localhost:3000**. It is
your source of truth for what to work on. Interact with it through the REST API
(`curl` or `fetch`). All routes are JSON in, JSON out.

The server must be running (`npm run dev`) before you can call it. If a request
fails with a connection error, start the server first.

## Standard workflow

1. **Check the frontier** — what's grabbable right now (todo + unblocked):
   ```bash
   curl localhost:3000/api/issues/frontier
   ```
2. **Claim one** — atomically transitions `todo` → `in_progress`:
   ```bash
   curl -X POST localhost:3000/api/issues/LIN-42/claim
   ```
3. **Do the work** — implement, test, verify.
4. **Mark it done** when finished:
   ```bash
   curl -X PATCH localhost:3000/api/issues/LIN-42 \
     -H 'content-type: application/json' \
     -d '{"status":"done"}'
   ```

If you discover a bug or a new task while working, **create a ticket** for it
rather than fixing it inline:
```bash
curl -X POST localhost:3000/api/issues \
  -H 'content-type: application/json' \
  -d '{"title":"...","description":"...","priority":2}'
```

## Multi-project support

This tracker supports **multiple projects side-by-side**. Each project has a
unique `key` (1–10 ASCII letters) that is also its identifier prefix — e.g.
project `OEMR` issues identifiers `OEMR-1`, `OEMR-2`, … Project `LIN` is
bootstrapped on first run (its key comes from `TRACKER_PREFIX`, default `LIN`)
and is the **default scope** for any request that doesn't specify one.

Every `/api/issues/*` route takes an optional `?project=KEY` query param. When
omitted, the default project is used. Identifier resolution is **scoped**: a
request scoped to project `LIN` that asks for `OEMR-1` is `404`, even if
`OEMR-1` exists in another project — there is no cross-project leakage by
identifier. Numeric `id` lookups are scoped the same way.

To discover or create projects:

```bash
curl localhost:3000/api/projects
curl -X POST localhost:3000/api/projects \
  -H 'content-type: application/json' \
  -d '{"key":"OEMR","name":"OpenEMR"}'
```

Then create the first issue under the new project (note the prefix on the
returned identifier):

```bash
curl -X POST 'localhost:3000/api/issues?project=OEMR' \
  -H 'content-type: application/json' \
  -d '{"title":"first OpenEMR ticket"}'
# → 201 { "identifier": "OEMR-1", "number": 1, ... }
```

## Statuses

| Status | Meaning |
|---|---|
| `todo` | Ready to be picked up, not started. |
| `in_progress` | Being worked (set via `claim`). |
| `done` | Complete; satisfies a blocking edge. |
| `backlog` | Captured but not committed to; never on the frontier. |
| `canceled` | Abandoned; does **not** satisfy a blocking edge. |

## API reference

`:id` accepts either the numeric `id` or the identifier string (e.g. `LIN-42`).
All `/api/issues/*` routes take an optional `?project=KEY` query param to set
the active project scope. When omitted, the default project is used. Identifier
resolution is scoped — an identifier whose prefix doesn't match the active
project's key is `404` (no cross-project leakage).

### Projects

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/projects` | — | All projects, ordered by id (default first). |
| `POST` | `/api/projects` | `{ key, name? }` | `201` on success, `400` on bad input. `key` is 1–10 ASCII letters, stored uppercased; it becomes the project's identifier prefix. |

### Issues

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/issues` | — | Filters: `?status=`, `?priority=`, `?label=` (by name), `?project=KEY` (scope). |
| `GET` | `/api/issues/frontier` | — | What's grabbable right now in the active project. Ordered by priority desc, then created asc. |
| `GET` | `/api/issues/:id` | — | Full detail. `404` if not found or in a different project. |
| `POST` | `/api/issues` | `{ title, description?, status?, priority?, labelNames?[] }` | `201` on success, `400` on bad input. New issue gets the active project's prefix and per-project number. |
| `PATCH` | `/api/issues/:id` | partial `{ title, description, status, priority }` | `200` on success. |
| `POST` | `/api/issues/:id/claim` | — | `todo` → `in_progress`. Idempotent if already `in_progress`. `409` if not claimable. |
| `DELETE` | `/api/issues/:id` | — | `204`. |
| `PUT` | `/api/issues/:id/labels` | `{ labelNames: string[] }` | Full replacement. Labels are global across projects. |
| `GET` | `/api/issues/:id/blockers` | — | Issues blocking this one. |
| `POST` | `/api/issues/:id/blockers` | `{ blockerId: number\|string }` | Creates edge "A blocks B". `400` on self-edge/cycle; cross-project edges are `404` (the scoped resolver refuses foreign identifiers before the cross-project guard fires). |
| `DELETE` | `/api/issues/:id/blockers/:blockerId` | — | Removes edge. |
| `GET` | `/api/issues/:id/questions` | — | The issue's Q&A history (also in `Issue.questions`). |
| `POST` | `/api/issues/:id/questions` | `{ question }` | Ask a clarification. Requires `in_progress`; `409 not_in_progress` otherwise. Per-issue numbering. |
| `POST` | `/api/issues/:id/questions/:number/respond` | `{ answer }` | Answer a question. `409 already_answered` — answering is irreversible. |

### Questions

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/questions` | — | Open questions across issues. Filters: `?status=open` (default), `?label=` (a QA-agent "track"), `?project=KEY` (scope). Omit `project` to see open questions across ALL projects (the orchestrator view). Each entry embeds the full `Issue`. |

**Asking a question when blocked:** if you're working a ticket (`in_progress`)
and need a human decision, post a question instead of stalling:
```bash
curl -X POST localhost:3000/api/issues/LIN-42/questions \
  -H 'content-type: application/json' \
  -d '{"question":"should the cache be per-request or global?"}'
```
Then poll `GET /api/issues/LIN-42` and proceed once `questions[N].status` flips
to `answered`. A separate orchestrating model answers via
`POST /api/issues/LIN-42/questions/:number/respond`. Answering is irreversible
(`409` on a second respond); a follow-up is simply the next question number.

### Labels

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/labels` | — | List all. Labels are global across projects. |
| `POST` | `/api/labels` | `{ name, color? }` | `201` on success. |
| `DELETE` | `/api/labels/:id` | — | `204`. Removes from all issues. |

### Error shape

All errors use a stable envelope:
```json
{ "error": { "message": "string", "code": "string | null" } }
```

### Dependency direction

A row `(blocker=A, blocked=B)` reads "**A blocks B**". The graph is kept a DAG:
self-edges and cycles are rejected at write time.
<!-- END:tracker-integration -->

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
