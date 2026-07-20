import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as schema from "./schema";
const { labels } = schema;

export type DB = BetterSQLite3Database<typeof schema>;

/**
 * Where the single SQLite file lives. Overridable via env so tests can point
 * at a throwaway file. Default: <repo>/data/tracker.db
 */
function dbPath(): string {
  const fromEnv = process.env.TRACKER_DB_PATH;
  if (fromEnv) return resolve(fromEnv);
  // data/ at the project root (two levels up from this file: src/lib/db -> repo).
  return resolve(process.cwd(), "data", "tracker.db");
}

/**
 * `true` once we've initialized the DB for the current process + path. The app
 * is single-user and local, so a module-level cache is fine.
 */
let _db: DB | null = null;
let _dbPath: string | null = null;

/** Raw sqlite instance kept so we can close it if ever needed. */
let _raw: Database.Database | null = null;

/**
 * Get the process-wide DB connection, creating the file + tables on first use.
 * Safe to call from route handlers, server components, and server actions.
 */
export function getDb(): DB {
  if (_db && _dbPath === dbPath()) return _db;
  _dbPath = dbPath();
  mkdirSync(resolve(_dbPath, ".."), { recursive: true });
  _raw = new Database(_dbPath);
  // WAL for better concurrency in the (rare) multi-process case.
  _raw.pragma("journal_mode = WAL");
  _raw.pragma("foreign_keys = ON");
  _db = drizzle(_raw, { schema });
  ensureSchema(_raw);
  return _db;
}

/**
 * Create the tables if missing. Idempotent. We use `CREATE TABLE IF NOT EXISTS`
 * rather than a migration runner so first-run "create the DB file" just works
 * with zero extra commands; the schema is small and stable.
 */
function ensureSchema(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      number        INTEGER NOT NULL UNIQUE,
      identifier    TEXT    NOT NULL UNIQUE,
      title         TEXT    NOT NULL,
      description   TEXT,
      status        TEXT    NOT NULL DEFAULT 'backlog',
      priority      INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS labels (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT    NOT NULL UNIQUE,
      color TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_labels (
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS dependencies (
      blocker_issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      blocked_issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      PRIMARY KEY (blocker_issue_id, blocked_issue_id)
    );

    -- Agent clarification channel: a question an implementing agent posts
    -- against an in_progress issue, and the orchestrating model's answer. State
    -- is derived (answered_at IS NULL ⇒ open). number is a per-issue sequence.
    CREATE TABLE IF NOT EXISTS issue_questions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id     INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      number       INTEGER NOT NULL,
      question     TEXT    NOT NULL,
      answer       TEXT,
      created_at   INTEGER NOT NULL,
      answered_at  INTEGER,
      UNIQUE(issue_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_questions_open ON issue_questions(answered_at);

    -- Single-row counter table for the issue-number high-water mark. Using a
    -- persistent counter (instead of MAX(number)+1) guarantees numbers are
    -- never reused, even after the highest-numbered issue is deleted.
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO meta (key, value) VALUES ('issue_number_seq', 0);

    CREATE INDEX IF NOT EXISTS idx_issues_status        ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_issues_priority      ON issues(priority);
    CREATE INDEX IF NOT EXISTS idx_issues_number        ON issues(number);
    CREATE INDEX IF NOT EXISTS idx_issue_labels_label   ON issue_labels(label_id);
    CREATE INDEX IF NOT EXISTS idx_deps_blocked         ON dependencies(blocked_issue_id);
    CREATE INDEX IF NOT EXISTS idx_deps_blocker         ON dependencies(blocker_issue_id);
  `);
}

/**
 * Seed default labels on first run (only when the labels table is empty AND
 * the caller hasn't disabled it). Safe to call repeatedly.
 */
export function seedDefaultsIfNeeded(
  db: DB,
  defaults: { name: string; color: string }[] = DEFAULT_LABELS,
): void {
  const existing = db.select().from(labels).all();
  if (existing.length > 0) return;
  for (const d of defaults) {
    db.insert(labels).values({ name: d.name, color: d.color }).run();
  }
}

export const DEFAULT_LABELS: { name: string; color: string }[] = [
  { name: "bug", color: "#ef4444" },
  { name: "feature", color: "#3b82f6" },
  { name: "chore", color: "#9ca3af" },
  // Note: the "ready-for-agent" label is derived (injected virtually at read
  // time from an issue's status + blockers), so it is intentionally NOT seeded
  // as a stored label. See src/lib/config.ts.
];

export { schema };
