---
name: work-with-help
description: >
  Work a ticket (or a batch of tickets) from the OrbitTrack tracker with an advisor
  available to answer questions. Before implementing, explores the codebase read-only
  and posts a batch of sharp questions to the Q&A API (plan mode via the tracker,
  replacing the harness's human-gated plan mode). During implementation, asks
  reactively when blocked on a decision. Polls for answers and proceeds once received.
  The inverse of /work-independently (where Q&A is suppressed).
argument-hint: "[ticket-ids...]  (empty = work the frontier indefinitely)"
disable-model-invocation: true
---

# Work with help

You are implementing tickets from the OrbitTrack tracker at `http://localhost:3000`.
An advisor is listening — you can and should ask questions through the Q&A channel
when you need a decision you can't resolve alone. The advisor reads your question
with full issue context embedded and responds asynchronously.

This is the same work loop as `/work-independently`, with one difference: **you
route decisions to the advisor through the tracker instead of guessing or stalling
on a harness prompt.** Everything else — claim, implement, verify, mark done,
blocking order, waiting — is identical. Read `/work-independently` for those
mechanics; this skill only covers what's different.

## Your queue

Same argument semantics as `/work-independently`:

- **Specific ticket** — `/work-with-help 42`
- **Assigned batch** — `/work-with-help 7 9 10`
- **Frontier** — `/work-with-help` (no args)

See `/work-independently` for the claim → work → done loop and blocking-order rules.

## When to ask

Ask when you hit a decision point that affects the correctness or direction of
the work and that you cannot resolve from the ticket description, the codebase,
or the repo's conventions. Concretely:

- **Architectural choices** — "should this cache be per-request or global?"
- **Ambiguity in the spec** — "the ticket says 'improve performance' but doesn't
  name a target; is 2x enough?"
- **Missing requirements** — "should this handle the empty-list case, or is that
  out of scope?"

Do not ask things you can answer yourself by reading the code. Do not ask for
permission to do the obvious thing. The advisor is a scarce resource — treat
questions like they cost money, because the expensive model answering them does.

## How to ask

```bash
curl -X POST localhost:3000/api/issues/:id/questions \
  -H 'content-type: application/json' \
  -d '{"question":"should the cache be per-request or global?"}'
```

The API requires the issue to be `in_progress` (you must have claimed it first).
Questions are numbered per-issue: your first is question 1, a follow-up is 2, etc.
Each question embeds the full issue context for the advisor automatically — you
don't need to repeat the ticket description.

Formulate sharp questions. A good question states the decision, the options you
see, and your lean — so the advisor can confirm or correct efficiently. Bad:
"how should I do this?" Good: "I can implement this as a server action or a
route handler. Server action matches the existing pattern in this repo. Should
I go with that?"

## Two questioning phases

**Phase 1 — Pre-implementation (plan mode via the API).** After claiming, before
writing code, explore the codebase read-only. Identify the real decision points.
Post them as a batch. Then poll until all are answered (see Polling, below). This
replaces the harness's human-gated plan mode: instead of surfacing questions to
a human through the harness UI, you route them to the advisor through the tracker.

If your harness forces its own plan mode and intercepts questions before you can
redirect them, use the harness plan mode for codebase exploration but still post
your decision questions to the Q&A API — the advisor answers through the tracker,
not through the harness approval flow.

**Phase 2 — Reactive (during implementation).** Work autonomously between decision
points. When you hit something you can't resolve — an ambiguity, an architectural
choice, a missing requirement — post a question and wait. Don't guess, don't
push through.

## Polling for answers

After posting, poll the issue until your question's status flips to `answered`:

```bash
curl localhost:3000/api/issues/:id
```

The response includes a `questions[]` array. Each question has a `status` of
`open` or `answered`, and an `answer` field when answered. Poll every 30–60
seconds — use your harness's wait mechanism, do not busy-poll.

Once answered, read the answer, incorporate it, and proceed. If the answer raises
a follow-up, post the next question (it will be the next number in the sequence).
Do not re-ask an answered question — answering is irreversible and a follow-up is
simply a new question.

## When not to ask

- Don't ask before claiming — questions require `in_progress`.
- Don't ask about the obvious implementation choice when the codebase or repo
  conventions already answer it.
- Don't ask "is this good?" — verify your own work with tests and typechecks.
  The advisor guides decisions, not quality assurance.

## If the advisor is wrong

You can see the full conversation. If an answer seems wrong, you may post a
follow-up question explaining your concern, but you should generally defer to
the advisor's guidance — it has more context on the intent. If the advisor's
answer would lead to clearly broken work, stop and surface to the human in your
harness rather than implementing something you believe is wrong.
