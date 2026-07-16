import { eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import * as s from "./db/schema";
import { PROJECT_PREFIX } from "./config";

/**
 * Resolve a route `:id` param — which the contract says may be either the
 * numeric `id` or the `identifier` string (e.g. `LIN-42`) — to the issue row.
 * Returns `null` when not found. Prefix matching is case-insensitive on the
 * alphabetic part so `lin-42` works too.
 */
export function resolveIssue(
  db: DB,
  idOrIdentifier: string | number,
): s.IssueRow | null {
  // Numeric form: pure integer → match on id.
  if (typeof idOrIdentifier === "number") {
    return (
      db.select().from(s.issues).where(eq(s.issues.id, idOrIdentifier)).get() ??
      null
    );
  }

  const str = String(idOrIdentifier).trim();

  // Pure number string → id.
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return db.select().from(s.issues).where(eq(s.issues.id, n)).get() ?? null;
  }

  // Identifier form: PREFIX-NUMBER. Case-insensitive on the prefix.
  const match = str.match(/^([A-Za-z]+)-(\d+)$/);
  if (match) {
    const [, prefix, num] = match;
    if (prefix.toUpperCase() === PROJECT_PREFIX.toUpperCase()) {
      const exact = `${PROJECT_PREFIX}-${num}`;
      return (
        db.select().from(s.issues).where(eq(s.issues.identifier, exact)).get() ??
        null
      );
    }
    return null;
  }

  return null;
}

/**
 * Atomically reserve and return the next project-wide issue number. Uses a
 * persistent high-water counter (meta.issue_number_seq) so numbers are NEVER
 * reused, even after the highest-numbered issue is deleted.
 *
 * Runs inside the caller's transaction so concurrent creates serialize on the
 * counter row. Uses UPDATE … RETURNING via Drizzle's `.values()`-free raw SQL
 * to keep it a single statement; better-sqlite3 supports RETURNING.
 */
export function nextIssueNumber(db: DB): number {
  const row = db
    .get<{ value: number }>(
      sql`UPDATE meta SET value = value + 1 WHERE key = 'issue_number_seq' RETURNING value`,
    );
  if (row && typeof row.value === "number") return row.value;

  // Defensive: the row is created in ensureSchema, but guard regardless.
  db.run(
    sql`INSERT OR IGNORE INTO meta (key, value) VALUES ('issue_number_seq', 0)`,
  );
  const next = db.get<{ value: number }>(
    sql`UPDATE meta SET value = value + 1 WHERE key = 'issue_number_seq' RETURNING value`,
  );
  return next!.value;
}

export function identifierFor(number: number): string {
  return `${PROJECT_PREFIX}-${number}`;
}
