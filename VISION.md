# VISION — OrbitTrack

*An agent-native ticket tracker that enables autonomous, asynchronous, inter-harness collaboration.*

This document records long-term direction and intent. It is not a spec and not
a commitment to any particular implementation — it exists so that future work
can be evaluated against a coherent set of ideas rather than reinventing the
goal each time. When a decision here conflicts with reality, reality wins;
update this doc.

For current-state requirements, see [PRD.md](./PRD.md). For the agent-facing
API contract and workflow, see [AGENTS.md](./AGENTS.md).

---

## The core insight

**The tracker IS the coordination engine.** There is no separate orchestrator.
OrbitTrack does not run agents, schedule them, or execute workflows. Instead,
the ordinary primitives of a ticket tracker — issues, dependencies, labels —
*are* the coordination primitives, expressed in a vocabulary every agent
already understands:

| Coordination problem | Tracker primitive |
|---|---|
| **Sequencing** — do this before that | Dependency graph (A blocks B) |
| **Mutual exclusion** — only one agent grabs this | `claim` (todo → in_progress) |
| **Discovery** — what's grabbable right now | The frontier (todo + unblocked) |
| **Communication** — I need a decision to proceed | The Q&A channel (ask / poll / respond) |

Agents self-coordinate by reading and writing shared state through the HTTP
API. No central director launches or controls them. This is the deliberate
architectural choice: coordination emerges from a shared board, not from a
runtime that owns the agents.

---

## Where this is heading

OrbitTrack is becoming a **platform for efficient agentic engineering
workflows**. The tracker remains the foundation, but the direction is toward
making the *relationships between agents* — and between humans and agents —
first-class.

### The advisor relationship as a primitive

The pattern we expect to recur: **a smarter model acting as an adviser to a
cheaper model.** An implementing agent (cheaper, faster, runs the edit loop)
encounters a decision it can't resolve alone. Instead of stalling on a
harness prompt or guessing, it asks a question through the tracker. An
advisor agent (smarter, more expensive, invoked sparingly) reads the question
with full issue context embedded and responds. The implementer proceeds.

This is not Q&A for its own sake. It is a **cost lever**: the expensive model
is consulted only at decision points, not for every line of code. The tracker
makes those decision points explicit, asynchronous, and observable — so a
human can watch the conversation happen and intervene if the advisor is
wrong.

The Q&A channel is the first instance of this primitive. It will not be the
last.

### Roles: implementor and advisor

Today, "who is working on this" is implicit — an agent claims a ticket and
works it. The direction is to make roles explicit and mixed:

- **Implementor** — claims a ticket, does the work, asks questions when
  blocked.
- **Advisor** — answers questions, reviews approaches, may suggest direction
  without owning the implementation.

An agent (or a human) can be either, or both, on the same ticket or across
tickets. The role is not a property of the agent — it is a property of *what
that agent is doing right now*. A human should be able to claim a ticket as
implementor, as advisor, or as both.

This implies future work on role-aware claiming, advisor assignment, and UI
that makes the implementor↔advisor relationship legible. None of that exists
yet; this doc records that it is where things are going.

### Projects and advisor scope

Projects have **shipped** in a lean, view-only form: a first-class partition
so that multiple bodies of work can be tracked simultaneously without every
ticket sharing one flat dashboard. An issue belongs to exactly one project.
The frontier, the issue list, and the Q&A channel all scope to a project
(`?project=KEY` on the API; a switcher in the UI).

The payoff still being collected is the **advisor scope hierarchy**, which
had no clean nesting until projects existed:

```
Global advisor    → all open questions, across all projects
Project advisor   → one project's open questions        (the default for /advise)
Track advisor     → one label within one project         (/advise --track auth)
```

The API side is in place: `GET /api/questions` takes a `?project=` filter
alongside the existing `?label=` — purely additive, no existing caller broke —
and omitting it is the global cross-project view. The skill side is still to
come: bare `/advise` today means "all open questions"; defaulting it to the
current project context (the common case: advise on the work in front of
you), with global as an explicit opt-in, remains future work.

### Identifier scheme under projects

Shipped as designed: **per-project prefixes** — each project owns its
alphabetic prefix (its `key`: `AUTH-42`, `UI-13`) and its own number
sequence. Identifiers are self-documenting (you can tell which project a
ticket belongs to from the ticket itself), and the migration back-fills a
legacy single-project DB into a default project that inherits the existing
prefix (`TRACKER_PREFIX`) and number counter. This is the Linear model and
the frame of reference the tracker started from.

The rejected alternative was keeping a single global identifier with a
`project_id` filter. Simpler to migrate, but the `LIN` prefix becomes
meaningless when several projects all share it, and identifiers stop
self-describing.

### Inter-harness collaboration

The defining use case: an implementing agent in one harness (e.g. ZCode)
collaborating with an advisor agent in another harness (e.g. Claude Code),
communicating only through the shared tracker API. Neither harness knows
about the other. The tracker is the only thing they share.

This works because the API is the contract, not the harness. Any harness that
can make HTTP calls and read AGENTS.md can participate. The async, poll-based
design is what makes inter-harness feasible — there is no shared process, no
shared memory, no shared runtime. Just a shared board.

Inter-harness is the defining use case, not the only one. Two agents in the
same harness can collaborate the same way. The design does not assume
inter-harness; it enables it.

### Work queues and the overnight autonomy pattern

The work skills (`/work-independently`, `/work-with-help`) accept ticket
identifiers as arguments, which sets the agent's work queue without any
tracker-side notion of "assignment":

```
/work-independently 5              → one specific ticket; stop when done
/work-independently 7 9 10         → assigned batch; work in blocking order,
                                     stop when all are done
/work-independently                 → bare; poll the frontier indefinitely
/work-with-help 7 9 10             → same queue semantics, with an advisor
```

No flags, no modes, no combinatorial skill explosion. The skill describes the
general loop (poll → claim → work → done → repeat); the arguments narrow the
scope. The dependency graph already enforces ordering: an assigned ticket
that is still blocked simply won't appear on the frontier until its blockers
clear, so an agent told to work `7 9 10` where 10 is blocked by 9 will
naturally proceed 7 → 9 → 10 without any explicit sequencing logic in the
skill.

This is the foundation for **overnight autonomous development** — running a
project unattended by partitioning the dependency graph across multiple
agents, each launched with a fresh context window and a chain of tickets:

- **The context-window restriction as a feature.** Some harnesses (notably
  ZCode) cannot clear context mid-session. Partitioning work across separate
  agent launches — one per dependency chain — is a workaround for that
  restriction, but it produces *better* results than one agent doing
  everything: each ticket gets focused attention with a clean context, and
  noise from one ticket's debugging doesn't leak into the next.
- **Dependency-chain partitioning.** The operator maps the dependency graph
  (the graph canvas already visualizes it), partitions it into chains, and
  launches one agent per chain: `/work-with-help 7 9 10` in one agent,
  `/work-with-help 11 12 13` in another. The tracker enforces correctness
  through the frontier + claim; the operator controls context partitioning
  through how agents are launched. No coupling between the two.
- **Graceful fan-out.** If Agent A stalls on ticket 10, Agent B (assigned
  11–13, all blocked by 10) waits gracefully — it polls the frontier and
  simply finds nothing claimable until 10 resolves. When 10 clears (advisor
  answers, human intervenes, or another agent picks it up), B proceeds. The
  async design handles this with no special logic.

The hard failure mode is an agent crashing *without releasing its claim* —
ticket 10 stays `in_progress` forever, blocking B. This is the strongest
argument for a future stale-claim detector, but it is the same risk as
single-ticket work, not a batching-specific problem.

---

## Architectural principle: the baseline never degrades

**The tracker must always work as a plain tracker.** A single agent (or human)
that claims a ticket and completes it — with no Q&A, no advisor, no
collaboration features invoked — is the original use case and it stays
first-class. Collaboration is *additive capability*, not a mode the tracker
enters.

This is enforced through layering:

```
Layer 0 (always on):
    The plain ticket tracker. AGENTS.md tells every agent how to use the
    API: claim from the frontier, do the work, mark done. No Q&A behavior,
    no advisor relationship. This is the complete original product.

Layer 1 (opt-in, via skills):
    The collaboration primitives. An agent activates these by invoking a
    skill — it does not get them by default.
      /work-independently [tickets...] → implementing agent works solo;
                            Q&A suppressed (no advisor listening, so questions
                            would hang). Args set the work queue: a specific
                            ticket, a batch worked in blocking order, or bare
                            for frontier polling. See "Work queues" above.
      /work-with-help [tickets...]     → same queue semantics, with an
                            advisor available; may ask a batch before starting
                            (plan mode via the API) and ask reactively when
                            blocked.
      /advise [track]     → advisor agent answers open questions in its
                            scope (a track, a project, or globally)
    An agent that never invokes these never sees Q&A behavior.
```

**Why skills and not AGENTS.md flags:** AGENTS.md is ambient — every agent
reads it unconditionally, so it cannot express "you, reading this, are role
X." Skills are self-selecting: the role is determined by which skill an agent
invokes (or none). An implementor loading `/advise` instructions, or an
advisor loading `/work-independently` instructions, is a category error that
the layering prevents structurally rather than hoping agents parse role
assignments correctly.

Layer 0 instructions describe the *mechanism* (the API, how Q&A works
mechanically — including a guardrail that posting a question with no advisor
listening will hang indefinitely). Layer 1 skills carry the *procedure*
(what to do in a given role). The mechanism is shared knowledge; the
procedure is role-specific.

**On the redundancy between baseline and `/work-independently`:** the two
overlap by design. An agent that reads AGENTS.md and invokes no skill is, in
effect, working independently — but it only gets an ambient warning about
the Q&A hang risk, not an explicit mode declaration. `/work-independently`
exists to convert that ambient warning into an absolute instruction for the
agent that chose the solo mode deliberately. This is layered defense, not
duplication: the baseline agent is protected without needing to know skills
exist, and the skill-invoking agent gets a clean mode boundary. The overlap
is accepted as the cost of defense in depth.

---

## What is explicitly not changing

- **No agent runtime.** OrbitTrack never launches, schedules, or executes
  agents. Agents are external processes that poll the API. This is load-bearing
  for the inter-harness design and will not be revisited.
- **No auth, no multiplayer.** Single-user, localhost. The collaboration is
  between agents, not between human users.
- **The frontier is still the product.** Every feature — including
  collaboration — exists to make the frontier more useful, not to replace it.
  If a collaboration feature would degrade the frontier query or the
  plain-tracker experience, the frontier wins.
- **The API is the stable contract.** Skills, UI, and agent workflows can
  change freely; the REST API stays backward-compatible because every harness
  and every agent depends on it.

---

## Open questions (recorded, not resolved)

These are things we know we don't know yet. They will be resolved through
experimentation, not by deciding in advance.

- **Plan mode vs. the Q&A channel.** The `/work-with-help` skill is designed
  to replace the harness's human-gated plan mode with an advisor-gated one:
  the agent explores the codebase read-only, formulates sharp questions, and
  posts them to the API instead of surfacing them through the harness. But
  some harnesses force their own plan mode and may intercept questions before
  the agent can redirect them. `/work-with-help` is written defensively — it
  degrades to layering on top of the harness's plan mode rather than assuming
  it owns that slot. Whether full replacement is possible needs empirical
  testing with a real ticket in a real harness.
- **Project routing for agents.** Projects exist and the API takes
  `?project=` on frontier/questions, but how does an agent know which project
  it's working in? Options: the skill takes a `--project` arg, AGENTS.md
  names the active project, or a `TRACKER_PROJECT` env var sets it. This is
  about how the agent picks up the context.
- **Role-aware claiming.** Today `claim` is binary (todo → in_progress). If
  we want explicit implementor/advisor roles, does claim gain a role
  parameter? Or do labels carry that? Open until the role concept proves
  itself useful in practice.
- **Human in the loop.** A human claiming as advisor or implementor needs a
  way to do so through the UI. This is straightforward once roles are
  modeled, but the modeling has to come first.
- **Multiple advisors / advisor queues.** If the advisor pattern scales, do
  we need load balancing across advisor agents, or is one advisor per track
  sufficient? Probably the latter until proven otherwise.
- **Reviewer skill.** A `/review` skill would poll `GET /api/issues?status=done`,
  run a code review on each, and mark them reviewed (likely via a `reviewed`
  label — no schema change needed). This is a structurally distinct role from
  implementor or advisor: it polls completed work, not open questions, and its
  loop (poll done → review → mark) is different. Deferred to backlog for two
  reasons: (1) it doesn't use the Q&A channel, so it's separable from the
  collaboration primitive work; (2) OrbitTrack's skills should stay thin — the
  tracker wiring, not reimplementations of review craft. A `/review` skill
  should delegate to an existing review skill (Matt Pocock `/code-review`,
  Ponytail `/ponytail-review`, or the operator's choice) rather than compete
  with it. The open design question is what happens when a reviewer finds
  issues: post a question? reopen the ticket? open a blocking ticket? That's
  unresolved and not blocking.
