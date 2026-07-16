---
name: work-independently
description: >
  Work a ticket (or a batch of tickets) from the OrbitTrack tracker to completion,
  solo — no advisor is listening. Claims from the frontier, implements, verifies,
  marks done. Suppressed the Q&A channel: questions posted with no advisor will
  hang forever, so do not post them. Use when you want an agent to deliver tickets
  autonomously without guidance. The inverse of /work-with-help.
argument-hint: "[ticket-ids...]  (empty = work the frontier indefinitely)"
disable-model-invocation: true
---

# Work independently

You are implementing tickets from the OrbitTrack tracker at `http://localhost:3000`.
No advisor is listening. Do not post questions to the Q&A API — they will never
be answered and your session will hang. If you genuinely cannot proceed, stop and
surface the problem to the human in your harness. Do not route it through the tracker.

## Your queue

The arguments set your work queue. Three modes:

- **Specific ticket** — `/work-independently 42`. Claim it, work it to done, stop.
- **Assigned batch** — `/work-independently 7 9 10`. Work them in blocking order
  (see below), stop when all are done.
- **Frontier** — `/work-independently` (no args). Poll the frontier indefinitely,
  claim whatever comes up, work it, loop.

## The loop

For each ticket in your queue, repeat:

1. **Check availability.** If you were given specific tickets, call
   `GET /api/issues/frontier` and find which of yours appear. A ticket that isn't
   on the frontier is either blocked or not `todo` — skip it and check the next.
   Do not try to claim a ticket that isn't on the frontier; you'll get a `409`.
   If none of your tickets are claimable yet, poll (see Waiting, below).

2. **Claim.** `POST /api/issues/:id/claim`. This atomically moves it `todo →
   in_progress`. If you get `409`, another agent claimed it first or it's blocked
   — move on.

3. **Understand the work.** Read the ticket's title, description, labels, and
   blockers (`GET /api/issues/:id`). Read the relevant code before writing anything.
   Respect the repo's conventions (check `AGENTS.md`, `CONTEXT.md`, any ADRs).

4. **Implement.** Do the work. Run typechecks and tests regularly. Follow the
   repo's testing conventions — if you have a testing skill installed, use it.

5. **Verify.** Typecheck, lint, run the full test suite. Do not mark done until
   the work passes. If the work can't be verified (broken tests you can't fix,
   ambiguity you can't resolve), stop and surface to the human — do not guess
   and do not mark done.

6. **Mark done.**
   ```bash
   curl -X PATCH localhost:3000/api/issues/:id \
     -H 'content-type: application/json' \
     -d '{"status":"done"}'
   ```

7. **Commit your work** to the current branch per the repo's git conventions.
   Reference the ticket identifier in the commit message.

8. **Next.** Move to the next claimable ticket in your queue. If none remain and
   you were given a specific list, you're done — stop. If you're in frontier
   mode, loop.

## Blocking order

When given multiple tickets (`/work-independently 7 9 10`), the tracker enforces
ordering for you: a ticket blocked by unfinished work is not on the frontier and
cannot be claimed. So you don't need to reason about ordering — just claim
whichever of your assigned tickets is available. If 10 is blocked by 9, and 9
is blocked by 7, the frontier will offer you 7 first, then 9 after 7 is done,
then 10 after 9 is done. Work them as they become claimable.

## Waiting

If none of your tickets are claimable yet (all blocked), poll the frontier
periodically. A reasonable cadence is every 30–60 seconds — use your harness's
wait mechanism. Do not busy-poll. When a ticket appears, resume the loop.

If you're in frontier mode and the frontier is empty, the queue is drained —
you're done. Stop.

## What not to do

- **Do not post questions.** No advisor is listening. `POST /api/issues/:id/questions`
  will create a question that hangs open forever.
- **Do not guess to keep moving.** If you can't resolve a decision, stop and tell
  the human. A stopped agent is recoverable; a wrong implementation marked done
  is worse — it satisfies a blocking edge and unblocks downstream work on a false
  premise.
- **Do not mark a ticket done unless it passes verification.** Done means done:
  tests pass, types check, the work is complete.
