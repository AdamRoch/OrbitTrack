import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

// ---- Controlled vocabularies (source of truth for status/priority) ----
// Declared first so the table below can reference them in the enum helper.

export const issueStatuses = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "canceled",
] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export const priorities = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof priorities)[number];

export const priorityLabels: Record<Priority, string> = {
  0: "No priority",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

/**
 * Logical schema for the tracker.
 *
 *   projects        — the top-level scope; the identifier prefix IS the key
 *   issues          — the core ticket entity, scoped to a project
 *   labels          — triage vocabulary (name + color); global across projects
 *   issue_labels    — many-to-many between issues and labels
 *   dependencies    — directed edge "blocker blocks blocked" (same-project only)
 *   issue_questions — per-issue Q&A channel
 *
 * Identifier scheme: `<PROJECT_KEY>-<number>` (e.g. LIN-42). The project key is
 * the identifier prefix; project keys are unique, so the identifier is globally
 * unique even though the *number* is per-project. `number` is a per-project
 * auto-increment assigned atomically from `projects.next_number` and never
 * reused; `identifier` is derived from `(key, number)` and stored for fast
 * lookups. Two projects may both have an issue #1 (`LIN-1`, `OEMR-1`).
 *
 * Dependency direction is fixed: a row (blocker=A, blocked=B) reads
 * "A blocks B" / "B is blocked by A". The frontier query for B checks that
 * every A where (A, B) exists has status = done. Edges are only ever created
 * between issues in the same project (no cross-project leakage).
 */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // The identifier prefix, e.g. "LIN" or "OEMR". Stored uppercased; alphabetic
  // only (no digits) so it can't collide with the numeric part of an identifier.
  // Unique case-insensitively (enforced on create; stored uppercase so the
  // UNIQUE constraint is sufficient).
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  // Per-project high-water counter for issue numbers. Using a stored counter
  // (instead of MAX(number)+1) guarantees numbers are never reused, even after
  // the highest-numbered issue is deleted. Atomically incremented at create.
  nextNumber: integer("next_number").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const issues = sqliteTable(
  "issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Per-project auto-increment; never reused, separate from the surrogate id.
    number: integer("number").notNull(),
    // Globally unique because project keys are globally unique. Stored as
    // `${projectKey}-${number}` so it round-trips through any external system.
    identifier: text("identifier").notNull().unique(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: issueStatuses }).notNull().default("backlog"),
    priority: integer("priority").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    // `number` is unique per project (two projects may both have a #1).
    // `identifier` is globally unique because keys are globally unique.
    uniqueIndex("issues_project_number_unique").on(t.projectId, t.number),
    index("idx_issues_project").on(t.projectId),
  ],
);

export const labels = sqliteTable("labels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
});

export const issueLabels = sqliteTable(
  "issue_labels",
  {
    issueId: integer("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: integer("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

export const dependencies = sqliteTable(
  "dependencies",
  {
    // The issue that must reach `done`.
    blockerIssueId: integer("blocker_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    // The issue that is held back until its blockers are done.
    blockedIssueId: integer("blocked_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.blockerIssueId, t.blockedIssueId] })],
);

// ---- Questions (agent clarification channel) ----
//
// A Question is posted by an implementing agent against an in_progress issue
// when it needs the human (via an orchestrating model) to clarify what to do.
// The state is *derived* — there is no stored status enum: `answeredAt IS NULL`
// ⇒ open (asked, awaiting an answer); a non-null `answeredAt` ⇒ answered.
//
// `number` is a per-issue sequence (every issue has its own Q1, Q2, …),
// assigned atomically inside the create transaction via MAX(number)+1 scoped to
// the issue. It is the address of record for a question within its issue.
// Answering is a single irreversible event; a second respond against an
// already-answered question is a 409, not an overwrite.
export const issueQuestions = sqliteTable(
  "issue_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    issueId: integer("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    // Per-issue sequence; the compound (issueId, number) is unique.
    number: integer("number").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    createdAt: integer("created_at").notNull(),
    answeredAt: integer("answered_at"),
  },
  (t) => [uniqueIndex("issue_questions_issue_number_unique").on(t.issueId, t.number)],
);

export type IssueRow = typeof issues.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
export type DependencyRow = typeof dependencies.$inferSelect;
export type QuestionRow = typeof issueQuestions.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

/**
 * A question's derived state. `open` = asked, awaiting an answer;
 * `answered` = an answer has been posted. Computed from `answeredAt`, never
 * persisted. Kept next to the schema so the controlled-vocabulary convention
 * (statuses/priorities above) is mirrored here.
 */
export const questionStatuses = ["open", "answered"] as const;
export type QuestionStatus = (typeof questionStatuses)[number];
