# OrbitTrack skills

Layer 1 collaboration skills — the procedures that wire the tracker's Q&A
mechanism to an agent's work loop. See [VISION.md](../VISION.md) for the full
layering model and the rationale behind these names.

## The skills

| Skill | Role | When to use |
|---|---|---|
| `/work-independently [tickets...]` | Implementor (solo) | Deliver tickets autonomously, no advisor. Q&A suppressed. |
| `/work-with-help [tickets...]` | Implementor (with advisor) | Same loop, but asks questions through the tracker at decision points instead of guessing. |
| `/advise [track]` | Advisor | Poll open questions and answer them. The counterpart to `/work-with-help`. |

All three share the same work-queue semantics: a specific ticket, a batch
worked in blocking order, or bare for frontier polling. The dependency graph
enforces ordering — an assigned-but-blocked ticket won't appear on the frontier
until its blockers clear.

## Installation

These are harness skills (SKILL.md files). Copy the directories into your
harness's skills location:

- **ZCode** — `~/.zcode/skills/` or `~/.agents/skills/`
- **Claude Code** — per its skills convention

The tracker itself doesn't need to know these skills exist. They're pure
procedure — they tell the agent *how to use* the API documented in
[AGENTS.md](../AGENTS.md). Any harness that can make HTTP calls and read
AGENTS.md can participate.

## The overnight pattern

For unattended multi-ticket runs, partition the dependency graph into chains
and launch one agent per chain:

```
Agent A:  /work-with-help 7 9 10      # one dependency chain
Agent B:  /work-with-help 11 12 13    # another, blocked by A's chain
Advisor:  /advise                      # answers questions from both
```

Each agent gets a fresh context window per ticket (some harnesses can't clear
context mid-session, so partitioning across launches is the workaround — and it
produces better results: each ticket gets focused attention). The tracker
enforces correctness through the frontier + claim; you control context
partitioning through how you launch agents.
