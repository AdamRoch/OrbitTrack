import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  uniqueIndex,
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
 *   issues          — the core ticket entity
 *   labels          — triage vocabulary (name + color)
 *   issue_labels    — many-to-many between issues and labels
 *   dependencies    — directed edge "blocker blocks blocked"
 *
 * Identifier scheme: `<PREFIX>-<number>` (e.g. LIN-42). `number` is a
 * project-wide auto-increment assigned atomically at creation and never
 * reused; `identifier` is derived from it and stored unique for fast lookups.
 *
 * Dependency direction is fixed: a row (blocker=A, blocked=B) reads
 * "A blocks B" / "B is blocked by A". The frontier query for B checks that
 * every A where (A, B) exists has status = done.
 */
export const issues = sqliteTable("issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Project-wide auto-increment; never reused, separate from the surrogate id.
  number: integer("number").notNull().unique(),
  identifier: text("identifier").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: issueStatuses }).notNull().default("backlog"),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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

/**
 * A question's derived state. `open` = asked, awaiting an answer;
 * `answered` = an answer has been posted. Computed from `answeredAt`, never
 * persisted. Kept next to the schema so the controlled-vocabulary convention
 * (statuses/priorities above) is mirrored here.
 */
export const questionStatuses = ["open", "answered"] as const;
export type QuestionStatus = (typeof questionStatuses)[number];
