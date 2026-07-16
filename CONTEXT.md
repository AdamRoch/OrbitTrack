# Tracker

A local, no-auth issue tracker for driving agentic development. The core
entity is the issue; around it sit labels, a dependency graph, and a
question-and-answer channel that lets an implementing agent ask a human
(via an orchestrating model) for clarification without leaving its loop.

## Language

**Issue**:
The unit of work an agent picks up, works, and reports done. The code and
API use "Issue" throughout; "ticket" is the preferred natural-language word
but a repo-wide rename is explicitly deferred.
_Avoid_: Task

**Question**:
A structured query posted by an implementing agent against an Issue, asking
the human (via an orchestrating model) for clarification. A first-class
entity — its own table and lifecycle — not text appended to the Issue's
description. Each Question is numbered in a per-issue sequence and addressed
by that integer `number` (never by its text).
_Avoid_: Note, comment (use these for free-form human remarks, not agent
clarification requests)

**Open / Answered**:
A Question's state, derived from `answeredAt`: `answeredAt IS NULL` ⇒ open
(asked, awaiting an answer); a non-null `answeredAt` ⇒ answered. There is no
stored status enum. Answering is a single, irreversible event — a second
respond against an already-answered Question is a 409, not an overwrite. A
follow-up clarification is simply the next Question number on the same Issue.
_Avoid_: Resolved, closed, done (those belong to Issues, not Questions)

**Track**:
The scope of a question-answering agent — the set of Issues whose Questions
it is responsible for. Defined as all Issues sharing a Label (e.g.
`label=auth`), because a Label marks *topical* coherence (same subsystem),
which is what keeps one QA context coherent. A Track is not a stored entity;
it is a query, materialized by `GET /api/questions?status=open&label=…`.
_Avoid_: Dependency neighborhood, dependency chain, epic (a dependency walk
encodes *sequencing*, not topicality, and crosses subsystems freely)

**Q&A Transcript**:
The read-only rendering of an Issue's Questions on its detail page — the
human's window into the agent conversation happening on that ticket. It is
observed, never participated in: asking and answering are API-only (agents),
and the UI only displays them, richly. An open Question reads as visibly
*pending* (the agent is waiting); an answered one reads as resolved. The
tracker is meant to be fun to watch, so this surface is first-class, not an
afterthought.
_Avoid_: Comment thread, chat (those imply human participation)

**Blocker**:
An Issue that must reach `done` before another Issue is on the frontier.
_Avoid_: Dependency (that names the edge, not the node)
