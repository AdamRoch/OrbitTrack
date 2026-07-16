import { describe, it, expect } from "vitest";
import { createHarness } from "./harness";

const api = createHarness();

/**
 * The harness shares one server + one DB across the whole file, so questions
 * from earlier tests accumulate in the global open list. Assert on a specific
 * issue's question rather than global totals.
 */
function openFor(body: any[], identifier: string): any[] {
  return body.filter((e) => e.issue.identifier === identifier);
}

/**
 * The Question channel: an implementing agent asks a clarification question on
 * an in_progress issue; an orchestrating model answers it. Tested through the
 * HTTP seam (the agent contract), against a real app + fresh temp DB.
 *
 * Lifecycle load-bearing rules under test:
 *  - asking requires `in_progress` (keeps open questions off the frontier)
 *  - numbers are a per-issue sequence starting at 1
 *  - state is derived from answeredAt (null ⇒ open)
 *  - answering is irreversible: a second respond is 409, not an overwrite
 *  - questions embed in GET /api/issues/:id and the global open-questions query
 */
describe("POST /api/issues/:id/questions", () => {
  it("creates a question on an in_progress issue, starting at number 1", async () => {
    const created = await api.createIssue({ title: "work me", status: "todo" });
    await api.claim(created.body.identifier);
    const res = await api.addQuestion(created.body.identifier, "what flavor?");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      number: 1,
      question: "what flavor?",
      answer: null,
      status: "open",
      answeredAt: null,
    });
    expect(res.body.createdAt).toBeTruthy();
  });

  it("increments the per-issue number across questions", async () => {
    const created = await api.createIssue({ title: "multi", status: "todo" });
    await api.claim(created.body.identifier);
    const q1 = await api.addQuestion(created.body.identifier, "one?");
    const q2 = await api.addQuestion(created.body.identifier, "two?");
    expect(q1.body.number).toBe(1);
    expect(q2.body.number).toBe(2);
  });

  it.each(["todo", "backlog", "done", "canceled"] as const)(
    "returns 409 not_in_progress when status is %s",
    async (status) => {
      const created = await api.createIssue({ title: `s-${status}`, status });
      const res = await api.addQuestion(created.body.identifier, "huh?");
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("not_in_progress");
    },
  );

  it("returns 404 for a missing issue", async () => {
    const res = await api.addQuestion("LIN-99999", "huh?");
    expect(res.status).toBe(404);
  });

  it("rejects an empty question with 400", async () => {
    const created = await api.createIssue({ title: "empty", status: "todo" });
    await api.claim(created.body.identifier);
    const res = await api.addQuestion(created.body.identifier, "   ");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("empty");
  });
});

describe("GET /api/issues/:id (questions embedding)", () => {
  it("includes an empty questions array on a fresh issue", async () => {
    const created = await api.createIssue({ title: "fresh" });
    const res = await api.getIssue(created.body.identifier);
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([]);
  });

  it("embeds the full Q&A history with derived status", async () => {
    const created = await api.createIssue({ title: "history", status: "todo" });
    await api.claim(created.body.identifier);
    await api.addQuestion(created.body.identifier, "first?");
    const q2 = await api.addQuestion(created.body.identifier, "second?");
    await api.respond(created.body.identifier, q2.body.number, "yes");

    const res = await api.getIssue(created.body.identifier);
    const qs = res.body.questions;
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ number: 1, status: "open", answer: null });
    expect(qs[1]).toMatchObject({
      number: 2,
      status: "answered",
      answer: "yes",
    });
    expect(qs[1].answeredAt).toBeTruthy();
  });

  it("exposes questions via GET /api/issues/:id/questions too", async () => {
    const created = await api.createIssue({ title: "list", status: "todo" });
    await api.claim(created.body.identifier);
    await api.addQuestion(created.body.identifier, "listed?");
    const res = await api.getQuestions(created.body.identifier);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].question).toBe("listed?");
  });
});

describe("POST /api/issues/:id/questions/:number/respond", () => {
  it("answers an open question, setting status to answered", async () => {
    const created = await api.createIssue({ title: "respond", status: "todo" });
    await api.claim(created.body.identifier);
    const q = await api.addQuestion(created.body.identifier, "go?");
    const res = await api.respond(created.body.identifier, q.body.number, "yes go");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      number: q.body.number,
      status: "answered",
      answer: "yes go",
    });
    expect(res.body.answeredAt).toBeTruthy();
  });

  it("returns 409 already_answered on a second respond", async () => {
    const created = await api.createIssue({ title: "twice", status: "todo" });
    await api.claim(created.body.identifier);
    const q = await api.addQuestion(created.body.identifier, "once?");
    await api.respond(created.body.identifier, q.body.number, "first");
    const second = await api.respond(
      created.body.identifier,
      q.body.number,
      "second",
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("already_answered");
  });

  it("returns 404 for a missing question number", async () => {
    const created = await api.createIssue({ title: "missing-q", status: "todo" });
    await api.claim(created.body.identifier);
    const res = await api.respond(created.body.identifier, 99, "nope");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing issue", async () => {
    const res = await api.respond("LIN-99999", 1, "nope");
    expect(res.status).toBe(404);
  });

  it("rejects an empty answer with 400", async () => {
    const created = await api.createIssue({ title: "empty-a", status: "todo" });
    await api.claim(created.body.identifier);
    const q = await api.addQuestion(created.body.identifier, "empty ans?");
    const res = await api.respond(created.body.identifier, q.body.number, "");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("empty");
  });
});

describe("GET /api/questions?status=open", () => {
  it("returns open questions across issues, each with the full embedded issue", async () => {
    const a = await api.createIssue({ title: "a", status: "todo" });
    const b = await api.createIssue({ title: "b", status: "todo" });
    await api.claim(a.body.identifier);
    await api.claim(b.body.identifier);
    await api.addQuestion(a.body.identifier, "from A?");
    await api.addQuestion(b.body.identifier, "from B?");

    const res = await api.openQuestions("?status=open");
    expect(res.status).toBe(200);
    // Both issues' open questions appear.
    const ids = res.body.map((e: any) => e.issue.identifier);
    expect(ids).toContain(a.body.identifier);
    expect(ids).toContain(b.body.identifier);
    // Each entry embeds a full IssueDTO including its questions[] history.
    for (const entry of res.body) {
      expect(entry.issue.identifier).toBeTruthy();
      expect(Array.isArray(entry.issue.questions)).toBe(true);
      expect(entry.question.status).toBe("open");
    }
  });

  it("drops a question off the open list once answered", async () => {
    const created = await api.createIssue({ title: "drop", status: "todo" });
    await api.claim(created.body.identifier);
    const q = await api.addQuestion(created.body.identifier, "then?");
    expect(openFor((await api.openQuestions()).body, created.body.identifier))
      .toHaveLength(1);
    await api.respond(created.body.identifier, q.body.number, "done");
    expect(openFor((await api.openQuestions()).body, created.body.identifier))
      .toHaveLength(0);
  });

  it("defaults to open when status is omitted", async () => {
    const created = await api.createIssue({ title: "default", status: "todo" });
    await api.claim(created.body.identifier);
    await api.addQuestion(created.body.identifier, "default open?");
    const res = await api.openQuestions();
    expect(openFor(res.body, created.body.identifier)).toHaveLength(1);
  });

  it("filters by label (the QA-agent track)", async () => {
    await api.createLabel({ name: "auth", color: "#ff0000" });
    const inTrack = await api.createIssue({ title: "in", status: "todo" });
    const outTrack = await api.createIssue({ title: "out", status: "todo" });
    await api.setLabels(inTrack.body.identifier, ["auth"]);
    await api.claim(inTrack.body.identifier);
    await api.claim(outTrack.body.identifier);
    await api.addQuestion(inTrack.body.identifier, "auth q?");
    await api.addQuestion(outTrack.body.identifier, "other q?");

    const res = await api.openQuestions("?label=auth");
    const ids = res.body.map((e: any) => e.issue.identifier);
    // The auth-labeled issue's question is included; the unlabeled one is not.
    expect(ids).toContain(inTrack.body.identifier);
    expect(ids).not.toContain(outTrack.body.identifier);
  });

  it("returns 400 for an unknown status value", async () => {
    const res = await api.openQuestions("?status=wat");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_status");
  });
});

describe("cascade on issue delete", () => {
  it("deletes an issue's questions when the issue is deleted", async () => {
    const created = await api.createIssue({ title: "doomed", status: "todo" });
    await api.claim(created.body.identifier);
    await api.addQuestion(created.body.identifier, "bye?");

    // Open list sees it before deletion.
    expect(openFor((await api.openQuestions()).body, created.body.identifier))
      .toHaveLength(1);

    await api.deleteIssue(created.body.identifier);
    expect(openFor((await api.openQuestions()).body, created.body.identifier))
      .toHaveLength(0);
  });
});
