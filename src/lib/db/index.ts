import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import * as schema from "./schema";
import { PROJECT_PREFIX } from "../config";
const { labels, projects } = schema;

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
  // Guarantee the default project exists so the app has a scope to operate in
  // before any /api/projects call is made. Idempotent.
  ensureDefaultProject(_raw);
  return _db;
}

/**
 * Create a fresh DB against an explicit path (used by tests). Bypasses the
 * process cache entirely and always creates the schema + default project.
 */
export function createDb(path: string): { db: DB; raw: Database.Database } {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  ensureSchema(raw);
  ensureDefaultProject(raw);
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
 * One-time pre-migration snapshot. When a legacy pre-projects DB is detected
 * (an `issues` table with no `project_id` column) and it holds real data, dump
 * issues / labels / issue_labels / dependencies / issue_questions to a
 * timestamped markdown file alongside the DB before the table rebuild runs.
 * Best-effort: any failure is logged and swallowed — it must never block startup.
 */
function snapshotBeforeProjectsMigration(raw: Database.Database): void {
  try {
    if (!tableExists(raw, "issues") || columnExists(raw, "issues", "project_id")) {
      return; // fresh DB or already migrated
    }

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
    const questions = tableExists(raw, "issue_questions")
      ? (raw.prepare("SELECT * FROM issue_questions ORDER BY id").all() as unknown[])
      : [];

    const lines: string[] = [
      "# Pre-migration snapshot",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Automatic backup taken before a schema migration on a DB with real data.",
      "Format: one JSON blob per table.",
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
      "## issue_questions",
      "```json",
      JSON.stringify(questions, null, 2),
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
 *
 * If a pre-projects DB is detected (legacy `issues` table with no `project_id`
 * column), `migrateLegacyIssuesTable` runs first to rebuild it under the new
 * shape before this function's CREATE TABLE IF NOT EXISTS no-ops on it.
 */
function ensureSchema(raw: Database.Database): void {
  // Belt-and-braces backup before any potentially-destructive migration.
  snapshotBeforeProjectsMigration(raw);

  // Legacy DB detection: an `issues` table that predates the projects schema
  // has no `project_id` column and has `number` declared UNIQUE at the table
  // level. Rebuild it forward before the CREATE TABLE IF NOT EXISTS below has
  // a chance to no-op on the old shape.
  if (tableExists(raw, "issues") && !columnExists(raw, "issues", "project_id")) {
    migrateLegacyIssuesTable(raw);
  }

  raw.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      next_number INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      number      INTEGER NOT NULL,
      identifier  TEXT    NOT NULL UNIQUE,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      description TEXT,
      status      TEXT    NOT NULL DEFAULT 'backlog',
      priority    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_issues_status        ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_issues_priority      ON issues(priority);
    CREATE INDEX IF NOT EXISTS idx_issues_number        ON issues(number);
    CREATE INDEX IF NOT EXISTS idx_issues_project       ON issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_issue_labels_label   ON issue_labels(label_id);
    CREATE INDEX IF NOT EXISTS idx_deps_blocked         ON dependencies(blocked_issue_id);
    CREATE INDEX IF NOT EXISTS idx_deps_blocker         ON dependencies(blocker_issue_id);

    -- number is unique per project (two projects may both have #1).
    -- identifier is already globally unique from the CREATE TABLE constraint
    -- (project keys are globally unique), so no separate index is needed.
    CREATE UNIQUE INDEX IF NOT EXISTS issues_project_number_unique
      ON issues(project_id, number);
  `);
}

/**
 * Migrate a legacy single-project `issues` table to the multi-project shape
 * in place. SQLite cannot drop columns or table-level UNIQUE constraints, so
 * we rebuild the table:
 *
 *   1. (Snapshot was already taken by the caller.)
 *   2. Create `projects` if missing and ensure a default project; its
 *      `next_number` is seeded from the legacy `meta.issue_number_seq` high-
 *      water mark if present (preserves the "never reuse numbers" invariant
 *      even after deletes), else `MAX(number)` over existing issues, else 0.
 *   3. Rename the legacy `issues` table aside, create the new one under the
 *      migrated shape, copy data over with `project_id` set to the default
 *      project, then drop the legacy table.
 *
 * Idempotent: detecting `issues.project_id` already present short-circuits the
 * whole thing (caller's responsibility).
 *
 * The rebuild runs as a single transaction with foreign-key enforcement off:
 * `DROP TABLE issues` would otherwise cascade-delete every issue_labels /
 * dependencies / issue_questions row, and a crash mid-rebuild would otherwise
 * strand all data in `issues_new`. PRAGMA foreign_keys is a no-op inside a
 * transaction, so it is toggled outside it.
 */
function migrateLegacyIssuesTable(raw: Database.Database): void {
  const fkBefore = raw.pragma("foreign_keys", { simple: true });
  raw.pragma("foreign_keys = OFF");
  try {
    raw.transaction(() => rebuildLegacyIssuesTable(raw))();
  } finally {
    raw.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
  }
}

function rebuildLegacyIssuesTable(raw: Database.Database): void {
  // Step 1: create the projects table so we can reference it.
  raw.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      next_number INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
  `);

  // Step 2: ensure a default project and seed its sequence. The default key
  // must come from the EXISTING issues' identifier prefix, not from
  // PROJECT_PREFIX: legacy identifiers (e.g. LIN-1) are copied verbatim below,
  // and resolveIssue rejects any identifier whose prefix != project.key. If the
  // operator changed TRACKER_PREFIX before the upgrade boot, keying the default
  // project off PROJECT_PREFIX would leave every migrated ticket unreachable by
  // identifier. The single-project legacy schema has one global prefix, so all
  // issues share it. Only fall back to PROJECT_PREFIX when there are no issues.
  const legacyKey = legacyIssuePrefix(raw);
  const defaultProject = ensureDefaultProject(raw, legacyKey);

  // Seed from the legacy high-water counter if present (preferred — it is the
  // authoritative never-reuse sequence). Fall back to MAX(number) so we never
  // reuse the highest existing number; if there are no issues, leave at 0.
  let seq = 0;
  const metaSeq = raw
    .prepare("SELECT value FROM meta WHERE key = 'issue_number_seq'")
    .get() as { value?: number } | undefined;
  if (metaSeq && typeof metaSeq.value === "number") {
    seq = metaSeq.value;
  } else {
    const max = raw.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM issues").get() as {
      n: number;
    };
    seq = max.n;
  }
  if (seq > defaultProject.nextNumber) {
    raw.prepare("UPDATE projects SET next_number = ? WHERE id = ?").run(
      seq,
      defaultProject.id,
    );
  }

  // Step 3: rebuild the issues table under the new shape. The legacy table has
  // `number` and `identifier` declared UNIQUE at the table level; we can't
  // DROP those constraints, so rename + create-new + copy + drop-old.
  raw.exec("DROP TABLE IF EXISTS issues_new;");
  raw.exec(`
    CREATE TABLE issues_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      number      INTEGER NOT NULL,
      identifier  TEXT    NOT NULL UNIQUE,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      description TEXT,
      status      TEXT    NOT NULL DEFAULT 'backlog',
      priority    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  raw.prepare(
    `INSERT INTO issues_new
       (id, number, identifier, project_id, title, description, status, priority, created_at, updated_at)
     SELECT id, number, identifier, ?, title, description, status, priority, created_at, updated_at
     FROM issues`,
  ).run(defaultProject.id);

  // Swap in the rebuilt table. Drop the old one (and its table-level UNIQUE
  // constraints on number / identifier) and rename.
  raw.exec("DROP TABLE issues;");
  raw.exec("ALTER TABLE issues_new RENAME TO issues;");

  // Recreate indexes that referenced the old table (they were dropped with it).
  raw.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_status   ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
    CREATE INDEX IF NOT EXISTS idx_issues_number   ON issues(number);
    CREATE INDEX IF NOT EXISTS idx_issues_project  ON issues(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS issues_project_number_unique
      ON issues(project_id, number);
  `);

  // Drop the legacy meta table if present (no longer used; replaced by
  // projects.next_number). Best-effort.
  raw.exec("DROP TABLE IF EXISTS meta;");
}

/**
 * Derive the default project's key from the legacy issues' identifier prefix
 * (the part before the first `-`, e.g. `LIN` in `LIN-1`). Project keys are
 * 1–10 ASCII letters with no `-`, so splitting on the first `-` is safe. The
 * single-project legacy schema has one global prefix; if identifiers are
 * somehow non-uniform we take the most common prefix, grouping
 * case-insensitively but returning the prefix exactly as stored — identifiers
 * are copied verbatim and resolveIssue's row lookup is case-sensitive, so the
 * key must match the stored casing (legacy configs never uppercased
 * TRACKER_PREFIX, so `lin-1` is valid legacy data). Returns null when there
 * are no issues (fresh/empty legacy DB) so the caller falls back to
 * PROJECT_PREFIX.
 */
function legacyIssuePrefix(raw: Database.Database): string | null {
  const rows = raw
    .prepare("SELECT identifier FROM issues")
    .all() as { identifier: string }[];
  const groups = new Map<string, Map<string, number>>();
  for (const { identifier } of rows) {
    const dash = identifier.indexOf("-");
    if (dash <= 0) continue; // malformed; skip
    const prefix = identifier.slice(0, dash);
    const upper = prefix.toUpperCase();
    const variants = groups.get(upper) ?? new Map<string, number>();
    variants.set(prefix, (variants.get(prefix) ?? 0) + 1);
    groups.set(upper, variants);
  }
  let bestVariants: Map<string, number> | null = null;
  let bestTotal = 0;
  for (const variants of groups.values()) {
    let total = 0;
    for (const n of variants.values()) total += n;
    if (total > bestTotal) {
      bestVariants = variants;
      bestTotal = total;
    }
  }
  if (!bestVariants) return null;
  let best: string | null = null;
  let bestN = 0;
  for (const [prefix, n] of bestVariants) {
    if (n > bestN) {
      best = prefix;
      bestN = n;
    }
  }
  return best;
}

function tableExists(raw: Database.Database, name: string): boolean {
  const row = raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(name) as { name?: string } | undefined;
  return !!row;
}

/** Does `table` have a column named `col`? Used for legacy-DB detection. */
function columnExists(raw: Database.Database, table: string, col: string): boolean {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return rows.some((r) => r.name === col);
}

/**
 * Ensure the default project exists. The key defaults to the TRACKER_PREFIX env
 * var (PROJECT_PREFIX, default LIN — see config.ts), but the legacy migration
 * passes `keyOverride` set to the existing issues' actual prefix so migrated
 * identifiers stay resolvable regardless of the current TRACKER_PREFIX.
 * Idempotent: returns the existing row if present. The first project by id is
 * the "default" for API requests that don't specify `?project=KEY`.
 *
 * Returns the plain row shape used by the migration path; live code reads the
 * project through Drizzle.
 */
function ensureDefaultProject(
  raw: Database.Database,
  keyOverride?: string | null,
): {
  id: number;
  key: string;
  name: string;
  nextNumber: number;
} {
  // Without an override, "the default project" is whatever project already
  // exists at the lowest id — NOT a fresh lookup by PROJECT_PREFIX. This matters
  // after a legacy migration keyed off the issues' prefix: if the operator
  // changed TRACKER_PREFIX, a PROJECT_PREFIX lookup would miss the migrated
  // project and wrongly create a second one. Only when no project exists at all
  // (fresh DB) do we create one keyed by PROJECT_PREFIX.
  const key = keyOverride ?? PROJECT_PREFIX;
  const lookup = keyOverride != null
    ? raw
        .prepare("SELECT id, key, name, next_number FROM projects WHERE key = ?")
        .get(key)
    : raw
        .prepare(
          "SELECT id, key, name, next_number FROM projects ORDER BY id LIMIT 1",
        )
        .get();
  const existing = lookup as
    | { id: number; key: string; name: string; next_number: number }
    | undefined;
  if (existing) {
    return {
      id: existing.id,
      key: existing.key,
      name: existing.name,
      nextNumber: existing.next_number,
    };
  }
  const now = Date.now();
  const info = raw
    .prepare(
      "INSERT INTO projects (key, name, next_number, created_at) VALUES (?, ?, 0, ?)",
    )
    .run(key, key, now);
  return { id: Number(info.lastInsertRowid), key, name: key, nextNumber: 0 };
}

/**
 * Seed default labels on first run (only when the labels table is empty AND
 * the caller hasn't disabled it). Safe to call repeatedly. Labels are global
 * across projects in the lean view-only model — a single shared vocabulary.
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

/**
 * The default project for this DB — the scope used by API requests that don't
 * pass `?project=KEY`. Defined as the lowest-id project (the first one created,
 * which on a legacy DB is the backfilled original). Returns null only if the
 * DB has no projects at all, which can't happen after getDb()/getServerDb().
 */
export function getDefaultProject(db: DB): schema.ProjectRow | null {
  return (
    db
      .select()
      .from(projects)
      .orderBy(projects.id)
      .limit(1)
      .get() ?? null
  );
}

/** Look up a project by its key (case-insensitive). Returns null if missing. */
export function getProjectByKey(db: DB, key: string): schema.ProjectRow | null {
  const upper = key.trim().toUpperCase();
  if (upper.length === 0) return null;
  return db.select().from(projects).where(eq(projects.key, upper)).get() ?? null;
}

/**
 * Atomically reserve and return the next per-project issue number. Increments
 * `projects.next_number` and returns the new value. Numbers are NEVER reused,
 * even after the highest-numbered issue in a project is deleted.
 *
 * Runs inside the caller's transaction so concurrent creates serialize on the
 * project row. Uses UPDATE … RETURNING via raw SQL (Drizzle's helper would
 * generate a less direct form); better-sqlite3 supports RETURNING.
 */
export function nextIssueNumber(db: DB, projectId: number): number {
  const row = db
    .get<{ next_number: number }>(
      sql`UPDATE projects SET next_number = next_number + 1 WHERE id = ${projectId} RETURNING next_number`,
    );
  if (row && typeof row.next_number === "number") return row.next_number;
  throw new Error(`project not found: id=${projectId}`);
}

export { schema, dbPath };
