import { issueStatuses, priorities, type IssueStatus, type Priority } from "./db/schema";

/**
 * Validation for API inputs. Each helper either returns the validated value or
 * throws `ValidationError`, which the route layer maps to a 400 with the stable
 * error shape. Keeping validation here means the rules live in one place and
 * are reusable from both the API and any future server actions.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

const STATUS_SET = new Set<string>(issueStatuses);
const PRIORITY_SET = new Set<number>(priorities);

const HEX_COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** A non-empty trimmed string. Empty/whitespace → 400. */
export function requireTitle(value: unknown, field = "title"): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, "invalid_type");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} must not be empty`, "empty");
  }
  return trimmed;
}

/**
 * A question's body text. Same rules as a title: non-empty trimmed string,
 * no length cap (a question can be a detailed design clarification). Mirrors
 * `requireTitle` with the field fixed for accurate error messages.
 */
export function requireQuestionText(value: unknown): string {
  return requireTitle(value, "question");
}

/**
 * An answer's body text. Same non-empty rules; no length cap. There is no
 * "clear answer" path — empty is an error, not an un-answer. A correction is
 * a new question.
 */
export function requireAnswerText(value: unknown): string {
  return requireTitle(value, "answer");
}

/** `null` clears the description; a string is trimmed of trailing whitespace. */
export function optionalDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError("description must be a string", "invalid_type");
  }
  return value.length === 0 ? null : value;
}

export function parseStatus(value: unknown): IssueStatus {
  if (value === undefined || value === null) {
    throw new ValidationError("status is required", "missing");
  }
  if (typeof value !== "string" || !STATUS_SET.has(value)) {
    throw new ValidationError(
      `status must be one of: ${issueStatuses.join(", ")}`,
      "invalid_status",
    );
  }
  return value as IssueStatus;
}

export function parseOptionalStatus(value: unknown): IssueStatus | undefined {
  if (value === undefined || value === null) return undefined;
  return parseStatus(value);
}

export function parsePriority(value: unknown): Priority {
  if (value === undefined || value === null) {
    throw new ValidationError("priority is required", "missing");
  }
  // Accept numbers or numeric strings; reject booleans (typeof true === ...).
  const n = typeof value === "number" ? value : Number(value);
  if (typeof value === "boolean" || !Number.isFinite(n) || !PRIORITY_SET.has(n)) {
    throw new ValidationError(
      `priority must be one of: ${priorities.join(", ")}`,
      "invalid_priority",
    );
  }
  return n as Priority;
}

export function parseOptionalPriority(value: unknown): Priority | undefined {
  if (value === undefined || value === null) return undefined;
  return parsePriority(value);
}

export function parseLabelNames(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError("labelNames must be an array", "invalid_type");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ValidationError("labelNames must contain only strings", "invalid_type");
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) continue; // tolerate empty entries
    if (seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

export function parseColor(value: unknown): string {
  const fallback = "#6b7280";
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !HEX_COLOR.test(value.trim())) {
    throw new ValidationError(
      "color must be a hex color like #aabbcc",
      "invalid_color",
    );
  }
  return value.trim();
}

export function parseLabelName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("name must be a string", "invalid_type");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("name must not be empty", "empty");
  }
  return trimmed;
}

/**
 * A project key — the identifier prefix. Rules:
 *   - 1–10 chars (keeps identifiers compact: `LIN-42`, `OEMR-9`).
 *   - ASCII letters only (no digits/symbols) so it can't collide with the
 *     numeric part of an identifier and survives `^([A-Za-z]+)-(\d+)$`.
 *   - Stored uppercased; the returned value is normalized.
 *
 * Length and alphabet are enforced here so the resolver's regex match stays a
 * reliable discriminator between identifier-form and numeric-form input.
 */
const PROJECT_KEY_RE = /^[A-Za-z]{1,10}$/;
export function parseProjectKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("key must be a string", "invalid_type");
  }
  const trimmed = value.trim();
  if (!PROJECT_KEY_RE.test(trimmed)) {
    throw new ValidationError(
      "key must be 1–10 ASCII letters (A–Z, a–z)",
      "invalid_key",
    );
  }
  return trimmed.toUpperCase();
}

/** A project display name — non-empty trimmed string. */
export function parseProjectName(value: unknown): string {
  return requireTitle(value, "name");
}
