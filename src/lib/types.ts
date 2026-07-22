import type { IssueStatus, Priority, QuestionStatus } from "./db/schema";

/**
 * Canonical JSON shapes — the agent contract. Every API read returns `Issue`;
 * every 4xx/5xx returns `ApiErrorBody`. Defined here as the single source of
 * truth so route handlers and tests share one definition.
 */
export interface LabelDTO {
  id: number;
  name: string;
  color: string;
}

/**
 * A project — the top-level scope for issues. The `key` IS the identifier
 * prefix (e.g. "LIN" → `LIN-42`). `nextNumber` is the per-project high-water
 * counter — the number most recently assigned; the next issue receives
 * `nextNumber + 1`. The first project by id is the default scope for API
 * requests that don't pass `?project=KEY`.
 */
export interface ProjectDTO {
  id: number;
  key: string;
  name: string;
  nextNumber: number;
  createdAt: string; // ISO-8601
}

/**
 * A question an implementing agent posted against an issue, plus (optionally)
 * the orchestrating model's answer. `status` is derived from `answeredAt`:
 * null ⇒ open (asked, awaiting an answer); non-null ⇒ answered. `number` is a
 * per-issue sequence (every issue has its own Q1, Q2, …) and is the address of
 * record within the issue. The full Q&A history is exposed so an answering
 * model can read prior exchanges as context.
 */
export interface QuestionDTO {
  id: number;
  number: number;
  question: string;
  answer: string | null;
  status: QuestionStatus; // derived: answeredAt == null ? "open" : "answered"
  createdAt: string; // ISO-8601
  answeredAt: string | null; // ISO-8601, null ⇒ open
}

export interface IssueDTO {
  id: number;
  identifier: string;
  number: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: Priority;
  labels: LabelDTO[];
  blockerIssueIds: number[];
  /**
   * `true` when this issue is on the frontier: status `todo` and every blocker
   * `done`. Mirrors `GET /api/issues/frontier`. This is a derived field, not
   * stored — recomputed on every read.
   */
  ready: boolean;
  /**
   * The issue's full Q&A history, oldest first. Embedded in every issue read
   * so an implementing agent checks for answers with a single `GET`, and an
   * answering model reads prior exchanges as context. Empty when no questions
   * have been asked. Derived from the `issue_questions` table at read time.
   */
  questions: QuestionDTO[];
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface ApiErrorBody {
  error: { message: string; code: string | null };
}

/** Input shape for POST /api/issues. */
export interface CreateIssueInput {
  title: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  labelNames?: unknown;
}

/** Input shape for PATCH /api/issues/:id. */
export interface UpdateIssueInput {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
}

export interface CreateLabelInput {
  name: unknown;
  color?: unknown;
}

/** Input shape for POST /api/issues/:id/questions. */
export interface CreateQuestionInput {
  question: unknown;
}

/** Input shape for POST /api/issues/:id/questions/:number/respond. */
export interface RespondToQuestionInput {
  answer: unknown;
}

/** Input shape for POST /api/projects. */
export interface CreateProjectInput {
  key: unknown;
  name?: unknown;
}
