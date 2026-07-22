import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createDb, getDefaultProject } from "../src/lib/db";
import { resolveIssue } from "../src/lib/identifiers";
import { PROJECT_PREFIX } from "../src/lib/config";

/**
 * Regression for the C-4 finding: the legacy→multi-project migration copied
 * each issue's identifier verbatim (e.g. LIN-1) but seeded the default
 * project's `key` from TRACKER_PREFIX (PROJECT_PREFIX), NOT from the issues'
 * actual prefix. If an operator changed TRACKER_PREFIX before the first
 * post-upgrade boot, the migrated tickets kept their old prefix while the
 * default project got the new one — and resolveIssue, which rejects any
 * identifier whose prefix != project.key, then 404'd every migrated ticket.
 *
 * This test seeds a legacy DB whose issues use a prefix DIFFERENT from the
 * current PROJECT_PREFIX (the "changed TRACKER_PREFIX" of the scenario:
 * identifiers under one prefix, env under another) and asserts the migration
 * keys the default project off the issues, keeping them reachable by
 * identifier. It fails against pre-fix `main` (default key = PROJECT_PREFIX).
 */

// A prefix that is guaranteed NOT to equal the in-process PROJECT_PREFIX, so
// the migration's env-based fallback would produce the wrong (unreachable) key.
const LEGACY_PREFIX = PROJECT_PREFIX === "OEMR" ? "ACME" : "OEMR";

function seedLegacyDb(path: string, prefix: string = LEGACY_PREFIX): void {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.exec(`
    CREATE TABLE issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number INTEGER NOT NULL UNIQUE,
      identifier TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL
    );
    CREATE TABLE issue_labels (
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, label_id)
    );
    CREATE TABLE dependencies (
      blocker_issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      blocked_issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      PRIMARY KEY (blocker_issue_id, blocked_issue_id)
    );
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);
  const now = Date.now();
  for (const [number, title] of [
    [1, "first"],
    [2, "second"],
    [3, "third"],
  ] as const) {
    raw
      .prepare(
        "INSERT INTO issues (number, identifier, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(number, `${prefix}-${number}`, title, "todo", 1, now, now);
  }
  raw.close();
}

describe("legacy migration keys default project off issue prefix, not TRACKER_PREFIX", () => {
  let dir = "";
  let dbPath = "";
  let savedDbPathEnv: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lc-migrate-prefix-"));
    dbPath = join(dir, "legacy.db");
    // Point the pre-migration snapshot (written next to dbPath()) at the temp
    // dir instead of the repo's data/ directory.
    savedDbPathEnv = process.env.TRACKER_DB_PATH;
    process.env.TRACKER_DB_PATH = dbPath;
  });

  afterEach(() => {
    if (savedDbPathEnv === undefined) delete process.env.TRACKER_DB_PATH;
    else process.env.TRACKER_DB_PATH = savedDbPathEnv;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("default project key equals the issues' original prefix", () => {
    // Precondition: the scenario only bites when they differ.
    expect(LEGACY_PREFIX).not.toBe(PROJECT_PREFIX);

    seedLegacyDb(dbPath);
    const { db, raw } = createDb(dbPath);
    try {
      const project = getDefaultProject(db);
      expect(project).not.toBeNull();
      expect(project!.key).toBe(LEGACY_PREFIX);
    } finally {
      raw.close();
    }
  });

  it("migrated tickets stay reachable by their original identifier", () => {
    seedLegacyDb(dbPath);
    const { db, raw } = createDb(dbPath);
    try {
      const project = getDefaultProject(db)!;
      for (const number of [1, 2, 3]) {
        const found = resolveIssue(db, project, `${LEGACY_PREFIX}-${number}`);
        expect(found, `${LEGACY_PREFIX}-${number} should resolve`).not.toBeNull();
        expect(found!.identifier).toBe(`${LEGACY_PREFIX}-${number}`);
      }
    } finally {
      raw.close();
    }
  });

  it("lowercase legacy prefix is preserved verbatim and stays resolvable", () => {
    // Legacy configs never uppercased TRACKER_PREFIX, so lowercase identifiers
    // like `lin-1` are valid legacy data. The derived key must match their
    // stored casing for resolveIssue's case-sensitive row lookup to hit.
    const lower = LEGACY_PREFIX.toLowerCase();
    seedLegacyDb(dbPath, lower);
    const { db, raw } = createDb(dbPath);
    try {
      const project = getDefaultProject(db)!;
      expect(project.key).toBe(lower);
      for (const number of [1, 2, 3]) {
        const found = resolveIssue(db, project, `${lower}-${number}`);
        expect(found, `${lower}-${number} should resolve`).not.toBeNull();
        expect(found!.identifier).toBe(`${lower}-${number}`);
      }
    } finally {
      raw.close();
    }
  });

  it("empty legacy DB still falls back to PROJECT_PREFIX", () => {
    // Fresh/empty legacy schema (issues table exists, no rows): the env-based
    // fallback path must remain unchanged.
    const raw0 = new Database(dbPath);
    raw0.exec(`
      CREATE TABLE issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number INTEGER NOT NULL UNIQUE,
        identifier TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `);
    raw0.close();

    const { db, raw } = createDb(dbPath);
    try {
      expect(getDefaultProject(db)!.key).toBe(PROJECT_PREFIX);
    } finally {
      raw.close();
    }
  });
});
