import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
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
 * is single-user and local, so a module-level cache is fine; tests opt out by
 * calling `createDb` / `resetDbCache` directly.
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
  ensureDirFor(_dbPath);
  _raw = new Database(_dbPath);
  // WAL for better concurrency in the (rare) multi-process case.
  _raw.pragma("journal_mode = WAL");
  _raw.pragma("foreign_keys = ON");
  _db = drizzle(_raw, { schema });
  ensureSchema(_raw);
  return _db;
}

/**
 * Create a fresh DB against an explicit path (used by tests). Bypasses the
 * process cache entirely and always creates the schema.
 */
export function createDb(path: string): { db: DB; raw: Database.Database } {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  ensureSchema(raw);
  return { db: drizzle(raw, { schema }), raw };
}

/** Force the next `getDb()` to reconnect. Useful in tests that swap the path. */
export function resetDbCache(): void {
  if (_raw) {
    try {
      _raw.close();
    } catch {
      /* ignore — may already be closed */
    }
  }
  _db = null;
  _raw = null;
  _dbPath = null;
}

/**
 * One-time pre-migration snapshot. When the `issue_questions` table does not
 * yet exist on a DB that already holds real data, dump issues / labels /
 * issue_labels / dependencies to a timestamped markdown file alongside the DB.
 * Best-effort: any failure is logged and swallowed — it must never block startup.
 */
function snapshotBeforeQuestionsMigration(raw: Database.Database): void {
  try {
    const hasQuestionsTable = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='issue_questions'",
      )
      .get() as { name?: string } | undefined;
    if (hasQuestionsTable) return; // already migrated

    const issueCount = raw.prepare("SELECT COUNT(*) AS n FROM issues").get() as {
      n: number;
    };
    if (issueCount.n === 0) return; // nothing to back up

    const issues = raw.prepare("SELECT * FROM issues ORDER BY id").all();
    const labels = raw
      .prepare("SELECT * FROM labels ORDER BY id")
      .all() as unknown[];
    const issueLabels = raw
      .prepare("SELECT * FROM issue_labels ORDER BY issue_id, label_id")
      .all() as unknown[];
    const deps = raw
      .prepare(
        "SELECT * FROM dependencies ORDER BY blocker_issue_id, blocked_issue_id",
      )
      .all() as unknown[];

    const lines: string[] = [
      "# Pre-questions-migration snapshot",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Automatic backup taken before `issue_questions` was first created, per the",
      "Q&A-channel migration safety net. Format: one JSON blob per table.",
      "",
      "## issues",
      "```json",
      JSON.stringify(issues, null, 2),
      "```",
      "",
      "## labels",
      "```json",
      JSON.stringify(labels, null, 2),
      "```",
      "",
      "## issue_labels",
      "```json",
      JSON.stringify(issueLabels, null, 2),
      "```",
      "",
      "## dependencies",
      "```json",
      JSON.stringify(deps, null, 2),
      "```",
      "",
    ];

    const dir = dirname(dbPath());
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(resolve(dir, `migration-snapshot-${stamp}.md`), lines.join("\n"));
  } catch (err) {
    // Best-effort: never let the snapshot block schema creation.
    console.error("[db] pre-migration snapshot failed:", err);
  }
}

/**
 * Create the tables if missing. Idempotent. We use `CREATE TABLE IF NOT EXISTS`
 * rather than a migration runner so first-run "create the DB file" just works
 * with zero extra commands; the schema is small and stable.
 */
function ensureSchema(raw: Database.Database): void {
  // Safety net: the first time an existing DB is upgraded to include the
  // question channel, snapshot the current data to a markdown file in data/.
  // Only fires when issue_questions is about to be created on a DB that has
  // real pre-existing data (so fresh test DBs and already-migrated DBs are
  // untouched). The dataset is small; this is a pure belt-and-braces backup.
  snapshotBeforeQuestionsMigration(raw);
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

/** Ensures the parent directory exists for a db file path. */
export function ensureDirFor(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export const DEFAULT_LABELS: { name: string; color: string }[] = [
  { name: "bug", color: "#ef4444" },
  { name: "feature", color: "#3b82f6" },
  { name: "chore", color: "#9ca3af" },
  // Note: the "ready-for-agent" label is derived (injected virtually at read
  // time from an issue's status + blockers), so it is intentionally NOT seeded
  // as a stored label. See src/lib/config.ts.
];

export { schema, dbPath };
