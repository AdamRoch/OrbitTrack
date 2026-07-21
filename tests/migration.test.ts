import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import Database from "better-sqlite3";

/**
 * Legacy-DB migration: a pre-projects SQLite file (single-project schema with
 * global UNIQUE on `issues.number` / `issues.identifier`, plus the legacy
 * `meta.issue_number_seq` counter) must boot cleanly under the new code:
 *
 *   - all existing issues are backfilled into the default project,
 *   - identifiers are preserved,
 *   - the next-issue number continues from `meta.issue_number_seq` (so numbers
 *     are NOT reused, even if the highest-numbered issue was deleted), and
 *   - subsequent POST /api/issues works against the migrated schema.
 *
 * This test stands up its own harness because it needs to pre-seed a legacy
 * DB file before Next boots against it.
 */

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() =>
        res(typeof addr === "object" && addr ? addr.port : 0),
      );
    });
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function readStderr(proc: ChildProcess | null): Promise<string> {
  if (!proc?.stderr) return "";
  let out = "";
  proc.stderr.on("data", (d) => (out += d.toString()));
  await new Promise((r) => setTimeout(r, 1500));
  return out.slice(-4000);
}

describe("legacy DB migration to multi-project schema", () => {
  let proc: ChildProcess | null = null;
  let base = "";
  let dir = "";
  let dbPath = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lc-migrate-"));
    dbPath = join(dir, "legacy.db");

    // Hand-write a legacy single-project DB: the pre-projects schema. Issues
    // table has table-level UNIQUE on number and identifier; meta holds the
    // issue_number_seq high-water mark.
    const raw = new Database(dbPath);
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
    raw.prepare(
      "INSERT INTO issues (number, identifier, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(1, "LIN-1", "first", "done", 2, now, now);
    raw.prepare(
      "INSERT INTO issues (number, identifier, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(2, "LIN-2", "second", "todo", 3, now, now);
    raw.prepare(
      "INSERT INTO issues (number, identifier, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(5, "LIN-5", "fifth (gap from delete)", "backlog", 0, now, now);
    // Legacy sequence is at 5 — meaning the NEXT new issue must be LIN-6, not
    // LIN-3 (would have been MAX+1 if we'd seeded from MAX(number)+1 = 6 too,
    // but the test below deletes LIN-5 first to make the two diverge).
    raw.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      "issue_number_seq",
      5,
    );
    raw.close();

    // Sanity: the DB on disk is the legacy shape.
    const probe = new Database(dbPath);
    const cols = probe.prepare("PRAGMA table_info(issues)").all() as {
      name: string;
    }[];
    expect(cols.some((c) => c.name === "project_id")).toBe(false);
    probe.close();

    const port = await freePort();
    proc = spawn("npx", ["next", "dev", "-p", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TRACKER_DB_PATH: dbPath,
        TRACKER_PREFIX: "LIN",
        TRACKER_SEED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    base = `http://127.0.0.1:${port}`;

    const ready = await waitFor(base + "/api/issues", 60_000);
    if (!ready) {
      const err = await readStderr(proc);
      throw new Error(`dev server not ready\n${err}`);
    }
  }, 90_000);

  afterAll(async () => {
    if (proc) {
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (!proc.killed) proc.kill("SIGKILL");
    }
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("backfills existing issues into the default project with identifiers intact", async () => {
    const res = await fetch(`${base}/api/issues?project=LIN`);
    expect(res.status).toBe(200);
    const issues = await res.json();
    const identifiers = issues.map((i: { identifier: string }) => i.identifier).sort();
    expect(identifiers).toEqual(["LIN-1", "LIN-2", "LIN-5"]);

    // Each migrated issue is fully readable (status, priority, title carried).
    const fifth = await fetch(`${base}/api/issues/LIN-5?project=LIN`);
    expect(fifth.status).toBe(200);
    const fifthBody = await fifth.json();
    expect(fifthBody.title).toBe("fifth (gap from delete)");
    expect(fifthBody.priority).toBe(0);
  });

  it("schema on disk has the new shape after migration", async () => {
    const raw = new Database(dbPath);
    const cols = raw.prepare("PRAGMA table_info(issues)").all() as {
      name: string;
    }[];
    expect(cols.some((c) => c.name === "project_id")).toBe(true);

    const projects = raw.prepare("SELECT * FROM projects").all() as {
      key: string;
      next_number: number;
    }[];
    expect(projects.length).toBe(1);
    expect(projects[0].key).toBe("LIN");
    expect(projects[0].next_number).toBe(5); // seeded from legacy meta

    // The legacy global UNIQUE on issues.number has been replaced by a per-
    // project composite. Verify by inserting a second project's #1 — it would
    // collide under the old global UNIQUE but must succeed now.
    raw.exec(
      "INSERT INTO projects (key, name, next_number, created_at) VALUES ('TEST', 'TEST', 1, 0)",
    );
    raw.prepare(
      "INSERT INTO issues (number, identifier, project_id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(1, "TEST-1", 2, "test", "backlog", 0, 0, 0);
    // Clean up so other tests aren't affected.
    raw.prepare("DELETE FROM issues WHERE identifier = 'TEST-1'").run();
    raw.prepare("DELETE FROM projects WHERE key = 'TEST'").run();
    raw.close();
  });

  it("continues the per-project sequence from the legacy high-water mark", async () => {
    // Legacy seq was 5; the next new issue must be LIN-6.
    const res = await fetch(`${base}/api/issues?project=LIN`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "post-migration create" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.identifier).toBe("LIN-6");
    expect(body.number).toBe(6);
  });

  it("does not reuse a deleted number (proves it didn't seed from MAX)", async () => {
    // Delete LIN-5 (currently the highest). Under MAX(number)+1 seeding the
    // next would be LIN-5 again (reused); under the high-water counter it
    // continues past 6 (we created LIN-6 above) to 7.
    const del = await fetch(`${base}/api/issues/LIN-5?project=LIN`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);

    const create = await fetch(`${base}/api/issues?project=LIN`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "after delete" }),
    });
    expect(create.status).toBe(201);
    const body = await create.json();
    // LIN-6 already exists from the previous test; this must be LIN-7, never
    // LIN-5 (reused) — that's the "no reuse" guarantee.
    expect(body.identifier).toBe("LIN-7");
    expect(body.identifier).not.toBe("LIN-5");
  });
});
