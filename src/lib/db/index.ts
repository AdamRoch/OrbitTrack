import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull, sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import * as schema from "./schema";
import { PROJECT_PREFIX, ADMIN_EMAIL, BOOTSTRAP_AGENT_TOKEN } from "../config";
const { labels, projects } = schema;

export type DB = BetterSQLite3Database<typeof schema>;

export type RegistrationSettings = {
  registrationsOpen: boolean;
  accountCap: number;
  activeAccountCount: number;
};

export type RegistrationResult =
  | { kind: "existing" | "created"; user: schema.UserRow }
  | { kind: "closed" | "full" | "identity_conflict" };

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
  const ownerId = ensureTenantSchema(_raw, _dbPath);
  ensureDefaultProject(_raw, null, ownerId);
  return _db;
}

/** Internal raw connection for small transactional infrastructure such as the
 * durable notification outbox. Application data access stays on Drizzle. */
export function getRawDb(): Database.Database {
  getDb();
  if (!_raw) throw new Error("database is not initialized");
  return _raw;
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
  const ownerId = ensureTenantSchema(raw, path);
  ensureDefaultProject(raw, null, ownerId);
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
 * Readiness is deliberately narrower than a liveness check: the process is
 * ready only after it can open the configured database, finish initialization,
 * and execute a harmless query. Errors stay inside this boundary so callers
 * never receive file paths, credentials, or SQLite details.
 */
export function isDatabaseReady(): boolean {
  try {
    const db = getDb();
    db.run(sql`SELECT 1`);
    return true;
  } catch {
    console.error("[health] database readiness check failed");
    return false;
  }
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
  // PROJECT_PREFIX: legacy identifiers (e.g. LIN-1) are copied below
  // (uppercased, matching the key), and resolveIssue rejects any identifier
  // whose prefix != project.key. If the operator changed TRACKER_PREFIX before
  // the upgrade boot, keying the default project off PROJECT_PREFIX would
  // leave every migrated ticket unreachable by identifier. The single-project
  // legacy schema has one global prefix, so all issues share it. Only fall
  // back to PROJECT_PREFIX when there are no issues.
  const legacyKey = legacyIssuePrefix(raw);
  const defaultProject = ensureDefaultProject(raw, legacyKey, 1);

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
     SELECT id, number, UPPER(identifier), ?, title, description, status, priority, created_at, updated_at
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
 * somehow non-uniform we take the most common prefix. The key is uppercased
 * per the project-key convention — legacy configs never uppercased
 * TRACKER_PREFIX, so `lin-1` is valid legacy data; the migration uppercases
 * the copied identifiers to match, making a migrated DB indistinguishable
 * from a fresh one. Returns null when there are no issues (fresh/empty legacy
 * DB) so the caller falls back to PROJECT_PREFIX.
 */
function legacyIssuePrefix(raw: Database.Database): string | null {
  const rows = raw
    .prepare("SELECT identifier FROM issues")
    .all() as { identifier: string }[];
  const counts = new Map<string, number>();
  for (const { identifier } of rows) {
    const dash = identifier.indexOf("-");
    if (dash <= 0) continue; // malformed; skip
    const prefix = identifier.slice(0, dash).toUpperCase();
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [prefix, n] of counts) {
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
  keyOverride: string | null | undefined,
  ownerId: number,
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
  // Legacy issue migration runs before the tenancy migration adds owner_id.
  // Use the old project shape for that one narrow transition; the subsequent
  // tenancy migration assigns the resulting project to the administrator.
  if (!columnExists(raw, "projects", "owner_id")) {
    const legacyLookup = keyOverride != null
      ? raw.prepare("SELECT id, key, name, next_number FROM projects WHERE key = ?").get(key)
      : raw.prepare("SELECT id, key, name, next_number FROM projects ORDER BY id LIMIT 1").get();
    const existing = legacyLookup as
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
    const info = raw
      .prepare("INSERT INTO projects (key, name, next_number, created_at) VALUES (?, ?, 0, ?)")
      .run(key, key, Date.now());
    return { id: Number(info.lastInsertRowid), key, name: key, nextNumber: 0 };
  }
  const lookup = keyOverride != null
    ? raw
        .prepare("SELECT id, key, name, next_number FROM projects WHERE key = ? AND owner_id = ?")
        .get(key, ownerId)
    : raw
        .prepare(
          "SELECT id, key, name, next_number FROM projects WHERE owner_id = ? ORDER BY id LIMIT 1",
        )
        .get(ownerId);
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
      "INSERT INTO projects (owner_id, key, name, next_number, created_at) VALUES (?, ?, ?, 0, ?)",
    )
    .run(ownerId, key, key, now);
  return { id: Number(info.lastInsertRowid), key, name: key, nextNumber: 0 };
}

/**
 * Forward-only tenancy migration. Existing local records become the configured
 * administrator's workspace. Tables are rebuilt because SQLite cannot remove
 * the old global UNIQUE constraints on project keys and label names.
 */
function ensureTenantSchema(raw: Database.Database, path: string): number {
  if (!ADMIN_EMAIL || !BOOTSTRAP_AGENT_TOKEN) {
    throw new Error("ORBITTRACK_ADMIN_EMAIL and ORBITTRACK_AGENT_TOKEN are required in production");
  }
  raw.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_subject TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS registration_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      registrations_open INTEGER NOT NULL DEFAULT 1 CHECK (registrations_open IN (0, 1)),
      account_cap INTEGER NOT NULL DEFAULT 10 CHECK (account_cap >= 0),
      active_account_count INTEGER NOT NULL DEFAULT 0 CHECK (active_account_count >= 0),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      owner_email TEXT NOT NULL,
      owner_name TEXT,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      delivered_at INTEGER,
      provider_id TEXT,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_due ON notification_outbox(status, next_attempt_at);
  `);
  const now = Date.now();
  let admin = raw.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL) as { id: number } | undefined;
  // Repair only the development placeholder created by pre-release builds;
  // never reassign a real Google-bound account merely because configuration
  // changed.
  if (!admin) {
    const placeholder = raw.prepare("SELECT id FROM users WHERE email = 'admin@orbittrack.local' AND is_admin = 1 AND google_subject IS NULL").get() as { id: number } | undefined;
    if (placeholder) {
      raw.prepare("UPDATE users SET email = ? WHERE id = ?").run(ADMIN_EMAIL, placeholder.id);
      raw.prepare("DELETE FROM agent_tokens WHERE owner_id = ? AND token_hash = ?")
        .run(placeholder.id, createHash("sha256").update("orbittrack-local-dev-token").digest("hex"));
      admin = placeholder;
    }
  }
  if (!admin) {
    const result = raw.prepare("INSERT INTO users (email, is_admin, created_at) VALUES (?, 1, ?)").run(ADMIN_EMAIL, now);
    admin = { id: Number(result.lastInsertRowid) };
  }
  const ownerId = admin.id;
  raw.prepare(
    "INSERT OR IGNORE INTO registration_settings (id, registrations_open, account_cap, active_account_count, updated_at) VALUES (1, 1, 10, (SELECT COUNT(*) FROM users WHERE is_admin = 0), ?)",
  ).run(now);
  const tokenHash = createHash("sha256").update(BOOTSTRAP_AGENT_TOKEN).digest("hex");
  raw.prepare("INSERT OR IGNORE INTO agent_tokens (owner_id, token_hash, name, created_at) VALUES (?, ?, 'bootstrap-agent', ?)").run(ownerId, tokenHash, now);

  if (!columnExists(raw, "projects", "owner_id") || !columnExists(raw, "labels", "owner_id")) {
    backupBeforeTenantMigration(raw, path);
  }
  if (!columnExists(raw, "projects", "owner_id")) {
    const fk = raw.pragma("foreign_keys", { simple: true });
    raw.pragma("foreign_keys = OFF");
    try {
      raw.transaction(() => {
        raw.exec(`CREATE TABLE projects_tenant_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          name TEXT NOT NULL,
          next_number INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          UNIQUE(owner_id, key)
        );`);
        raw.prepare("INSERT INTO projects_tenant_new (id, owner_id, key, name, next_number, created_at) SELECT id, ?, key, name, next_number, created_at FROM projects").run(ownerId);
        raw.exec("DROP TABLE projects; ALTER TABLE projects_tenant_new RENAME TO projects;");
      })();
    } finally { raw.pragma(`foreign_keys = ${fk ? "ON" : "OFF"}`); }
  }
  if (!columnExists(raw, "labels", "owner_id")) {
    const fk = raw.pragma("foreign_keys", { simple: true });
    raw.pragma("foreign_keys = OFF");
    try {
      raw.transaction(() => {
        raw.exec(`CREATE TABLE labels_tenant_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          UNIQUE(owner_id, name)
        );`);
        raw.prepare("INSERT INTO labels_tenant_new (id, owner_id, name, color) SELECT id, ?, name, color FROM labels").run(ownerId);
        raw.exec("DROP TABLE labels; ALTER TABLE labels_tenant_new RENAME TO labels;");
      })();
    } finally { raw.pragma(`foreign_keys = ${fk ? "ON" : "OFF"}`); }
  }
  raw.exec("CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id); CREATE INDEX IF NOT EXISTS idx_labels_owner ON labels(owner_id);");
  return ownerId;
}

function registrationSettingsFromRaw(raw: Database.Database): RegistrationSettings {
  const row = raw.prepare(
    "SELECT registrations_open, account_cap, active_account_count FROM registration_settings WHERE id = 1",
  ).get() as { registrations_open: number; account_cap: number; active_account_count: number };
  return {
    registrationsOpen: row.registrations_open === 1,
    accountCap: row.account_cap,
    activeAccountCount: row.active_account_count,
  };
}

/** Read platform registration state. Only callers that already authenticated an
 * administrator should expose this data to a browser. */
export function getRegistrationSettings(): RegistrationSettings {
  getDb();
  if (!_raw) throw new Error("database is not initialized");
  return registrationSettingsFromRaw(_raw);
}

/** Administrator-only mutation. The cap may be lowered below the current
 * count: that closes capacity for new accounts without affecting members. */
export function updateRegistrationSettings(input: {
  registrationsOpen: boolean;
  accountCap: number;
}): RegistrationSettings {
  getDb();
  if (!_raw) throw new Error("database is not initialized");
  if (!Number.isInteger(input.accountCap) || input.accountCap < 0 || input.accountCap > 10_000) {
    throw new Error("account cap must be an integer between 0 and 10000");
  }
  _raw.prepare(
    "UPDATE registration_settings SET registrations_open = ?, account_cap = ?, updated_at = ? WHERE id = 1",
  ).run(input.registrationsOpen ? 1 : 0, input.accountCap, Date.now());
  return registrationSettingsFromRaw(_raw);
}

/**
 * Find or atomically create the account behind a verified Google identity.
 * The conditional counter update is the capacity decision: only one writer can
 * consume a slot, so concurrent first sign-ins cannot exceed the cap.
 */
export function provisionGoogleUserOnDatabase(
  raw: Database.Database,
  email: string,
  googleSubject: string,
  name: string | null,
): RegistrationResult {
  const register = raw.transaction((): RegistrationResult => {
    const bySubject = raw.prepare("SELECT * FROM users WHERE google_subject = ?").get(googleSubject) as schema.UserRow | undefined;
    if (bySubject) return bySubject.email === email ? { kind: "existing", user: bySubject } : { kind: "identity_conflict" };

    const byEmail = raw.prepare("SELECT * FROM users WHERE email = ?").get(email) as schema.UserRow | undefined;
    if (byEmail) {
      raw.prepare("UPDATE users SET google_subject = ?, name = COALESCE(?, name) WHERE id = ? AND google_subject IS NULL")
        .run(googleSubject, name, byEmail.id);
      const linked = raw.prepare("SELECT * FROM users WHERE id = ?").get(byEmail.id) as schema.UserRow;
      return linked.googleSubject === googleSubject ? { kind: "existing", user: linked } : { kind: "identity_conflict" };
    }

    const settings = registrationSettingsFromRaw(raw);
    if (!settings.registrationsOpen) return { kind: "closed" };
    const claim = raw.prepare(
      "UPDATE registration_settings SET active_account_count = active_account_count + 1, updated_at = ? WHERE id = 1 AND registrations_open = 1 AND active_account_count < account_cap",
    ).run(Date.now());
    if (claim.changes !== 1) return registrationSettingsFromRaw(raw).registrationsOpen ? { kind: "full" } : { kind: "closed" };

    const createdAt = Date.now();
    const inserted = raw.prepare("INSERT INTO users (google_subject, email, name, is_admin, created_at) VALUES (?, ?, ?, 0, ?)")
      .run(googleSubject, email, name, createdAt);
    const user = raw.prepare("SELECT * FROM users WHERE id = ?").get(inserted.lastInsertRowid) as schema.UserRow;
    raw.prepare("INSERT INTO notification_outbox (dedupe_key, owner_email, owner_name, created_at, next_attempt_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`workspace-created:${user.id}`, user.email, user.name, createdAt, createdAt, createdAt);
    return { kind: "created", user };
  });
  return register();
}

export function provisionGoogleUser(email: string, googleSubject: string, name: string | null): RegistrationResult {
  getDb();
  if (!_raw) throw new Error("database is not initialized");
  return provisionGoogleUserOnDatabase(_raw, email, googleSubject, name);
}

export function createAgentToken(ownerId: number, name: string): { id: number; token: string } {
  getDb();
  if (!_raw) throw new Error("database is not initialized");
  const token = `ot_${randomBytes(24).toString("base64url")}`;
  const result = _raw.prepare(
    "INSERT INTO agent_tokens (owner_id, token_hash, name, created_at) VALUES (?, ?, ?, ?)",
  ).run(ownerId, createHash("sha256").update(token).digest("hex"), name, Date.now());
  return { id: Number(result.lastInsertRowid), token };
}

export function listAgentTokens(ownerId: number): Omit<schema.AgentTokenRow, "tokenHash">[] {
  getDb();
  if (!_raw) throw new Error("database is not initialized");
  return _raw.prepare(
    "SELECT id, owner_id AS ownerId, name, created_at AS createdAt, revoked_at AS revokedAt FROM agent_tokens WHERE owner_id = ? ORDER BY id DESC",
  ).all(ownerId) as Omit<schema.AgentTokenRow, "tokenHash">[];
}

export function revokeAgentToken(ownerId: number, tokenId: number): boolean {
  getDb();
  if (!_raw) throw new Error("database is not initialized");
  return _raw.prepare("UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL")
    .run(Date.now(), tokenId, ownerId).changes === 1;
}

export function listNotificationOutbox(): { id: number; ownerEmail: string; ownerName: string | null; createdAt: number; status: string; attempts: number; deliveredAt: number | null; lastError: string | null }[] {
  const raw = getRawDb();
  return raw.prepare("SELECT id, owner_email AS ownerEmail, owner_name AS ownerName, created_at AS createdAt, status, attempts, delivered_at AS deliveredAt, last_error AS lastError FROM notification_outbox ORDER BY id DESC LIMIT 100").all() as { id: number; ownerEmail: string; ownerName: string | null; createdAt: number; status: string; attempts: number; deliveredAt: number | null; lastError: string | null }[];
}

/** SQLite VACUUM INTO includes committed WAL state, unlike copying the .db file. */
function backupBeforeTenantMigration(raw: Database.Database, path: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.pre-tenant-${stamp}.db`;
  const quoted = backupPath.replace(/'/g, "''");
  try {
    raw.exec(`VACUUM INTO '${quoted}'`);
  } catch (error) {
    throw new Error(`refusing tenancy migration because SQLite backup failed: ${String(error)}`);
  }
}

/**
 * Seed default labels on first run (only when the labels table is empty AND
 * the caller hasn't disabled it). Safe to call repeatedly. Labels are global
 * across projects in the lean view-only model — a single shared vocabulary.
 */
export function seedDefaultsIfNeeded(
  db: DB,
  ownerId: number,
  defaults: { name: string; color: string }[] = DEFAULT_LABELS,
): void {
  const existing = db.select().from(labels).where(eq(labels.ownerId, ownerId)).all();
  if (existing.length > 0) return;
  for (const d of defaults) {
    db.insert(labels).values({ ownerId, name: d.name, color: d.color }).run();
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

export function getProjectByKeyForOwner(
  db: DB,
  ownerId: number,
  key: string,
): schema.ProjectRow | null {
  const upper = key.trim().toUpperCase();
  if (upper.length === 0) return null;
  return db.select().from(projects).where(and(eq(projects.ownerId, ownerId), eq(projects.key, upper))).get() ?? null;
}

export function getDefaultProjectForOwner(db: DB, ownerId: number): schema.ProjectRow | null {
  return db.select().from(projects).where(eq(projects.ownerId, ownerId)).orderBy(projects.id).limit(1).get() ?? null;
}

export function findUserByEmail(db: DB, email: string): schema.UserRow | null {
  return db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).get() ?? null;
}

export function bindGoogleSubject(db: DB, email: string, subject: string, name?: string | null): schema.UserRow | null {
  const user = findUserByEmail(db, email);
  if (!user) return null;
  if (user.googleSubject && user.googleSubject !== subject) return null;
  db.update(schema.users).set({ googleSubject: subject, name: name ?? user.name }).where(eq(schema.users.id, user.id)).run();
  return db.select().from(schema.users).where(eq(schema.users.id, user.id)).get() ?? null;
}

export function findActiveAgentByToken(db: DB, rawToken: string): schema.AgentTokenRow | null {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  return db.select().from(schema.agentTokens).where(and(eq(schema.agentTokens.tokenHash, tokenHash), isNull(schema.agentTokens.revokedAt))).get() ?? null;
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
