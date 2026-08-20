import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createDb } from "./db";

export const WORKSPACE_STATE_FORMAT = "orbittrack-workspace-state";
export const WORKSPACE_STATE_VERSION = 1;

const TABLES = [
  "users",
  "agent_tokens",
  "registration_settings",
  "notification_outbox",
  "projects",
  "labels",
  "issues",
  "issue_labels",
  "dependencies",
  "issue_questions",
] as const;

type TableName = (typeof TABLES)[number];
type Row = Record<string, unknown>;

export type WorkspaceState = {
  users: Row[];
  /** Token hashes are deliberately absent: imported credentials cannot authenticate. */
  agentTokens: Row[];
  registrationSettings: Row[];
  notificationOutbox: Row[];
  projects: Row[];
  labels: Row[];
  issues: Row[];
  issueLabels: Row[];
  dependencies: Row[];
  issueQuestions: Row[];
  sqliteSequences: { name: string; seq: number }[];
};

export type WorkspaceStateArtifact = {
  format: typeof WORKSPACE_STATE_FORMAT;
  version: typeof WORKSPACE_STATE_VERSION;
  exportedAt: string;
  source: { tableCounts: Record<string, number> };
  state: WorkspaceState;
  integrity: { canonicalSha256: string };
};

const STATE_KEYS: (keyof WorkspaceState)[] = [
  "users",
  "agentTokens",
  "registrationSettings",
  "notificationOutbox",
  "projects",
  "labels",
  "issues",
  "issueLabels",
  "dependencies",
  "issueQuestions",
  "sqliteSequences",
];

const TABLE_TO_STATE: Record<TableName, keyof WorkspaceState> = {
  users: "users",
  agent_tokens: "agentTokens",
  registration_settings: "registrationSettings",
  notification_outbox: "notificationOutbox",
  projects: "projects",
  labels: "labels",
  issues: "issues",
  issue_labels: "issueLabels",
  dependencies: "dependencies",
  issue_questions: "issueQuestions",
};

const ORDER_BY: Record<TableName, string> = {
  users: "id",
  agent_tokens: "id",
  registration_settings: "id",
  notification_outbox: "id",
  projects: "id",
  labels: "id",
  issues: "id",
  issue_labels: "issue_id, label_id",
  dependencies: "blocker_issue_id, blocked_issue_id",
  issue_questions: "id",
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(state: WorkspaceState): string {
  return createHash("sha256")
    .update(stableJson({ format: WORKSPACE_STATE_FORMAT, version: WORKSPACE_STATE_VERSION, state }))
    .digest("hex");
}

function rows(raw: Database.Database, table: TableName): Row[] {
  if (table === "agent_tokens") {
    return raw.prepare("SELECT id, owner_id, name, created_at, revoked_at FROM agent_tokens ORDER BY id").all() as Row[];
  }
  return raw.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER_BY[table]}`).all() as Row[];
}

function readState(raw: Database.Database): WorkspaceState {
  const state = {} as WorkspaceState;
  for (const table of TABLES) state[TABLE_TO_STATE[table]] = rows(raw, table) as never;
  state.sqliteSequences = raw.prepare(
    `SELECT name, seq FROM sqlite_sequence WHERE name IN (${TABLES.map(() => "?").join(",")}) ORDER BY name`,
  ).all(...TABLES) as { name: string; seq: number }[];
  return state;
}

function countTables(state: WorkspaceState): Record<string, number> {
  return Object.fromEntries(TABLES.map((table) => [table, (state[TABLE_TO_STATE[table]] as Row[]).length]));
}

/**
 * SQLite databases in WAL mode must not be copied directly. VACUUM INTO makes
 * a complete, transactionally-consistent snapshot which we immediately read.
 */
export function exportWorkspaceState(sourcePath: string): WorkspaceStateArtifact {
  const source = resolve(sourcePath);
  if (!existsSync(source)) throw new Error(`source database does not exist: ${source}`);
  const scratch = mkdtempSync(join(tmpdir(), "orbittrack-export-"));
  const snapshot = join(scratch, basename(source));
  const raw = new Database(source, { readonly: true });
  try {
    raw.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  } finally {
    raw.close();
  }
  const copy = new Database(snapshot, { readonly: true });
  try {
    const state = readState(copy);
    return {
      format: WORKSPACE_STATE_FORMAT,
      version: WORKSPACE_STATE_VERSION,
      exportedAt: new Date().toISOString(),
      source: { tableCounts: countTables(state) },
      state,
      integrity: { canonicalSha256: canonicalSha256(state) },
    };
  } finally {
    copy.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

function requireRows(value: unknown, name: string): Row[] {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`invalid artifact: state.${name} must be an array of rows`);
  }
  return value as Row[];
}

export function validateWorkspaceStateArtifact(value: unknown): WorkspaceStateArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid artifact: expected an object");
  const artifact = value as Partial<WorkspaceStateArtifact>;
  if (artifact.format !== WORKSPACE_STATE_FORMAT) throw new Error("incompatible artifact format");
  if (artifact.version !== WORKSPACE_STATE_VERSION) throw new Error(`incompatible artifact version: ${String(artifact.version)}`);
  if (!artifact.state || typeof artifact.state !== "object") throw new Error("invalid artifact: missing state");
  const state = artifact.state as Record<string, unknown>;
  if (Object.keys(state).length !== STATE_KEYS.length || STATE_KEYS.some((key) => !(key in state))) {
    throw new Error("invalid artifact: incomplete state tables");
  }
  for (const key of STATE_KEYS) requireRows(state[key], key);
  const normalised = artifact as WorkspaceStateArtifact;
  if (!normalised.integrity?.canonicalSha256 || normalised.integrity.canonicalSha256 !== canonicalSha256(normalised.state)) {
    throw new Error("invalid artifact: integrity checksum mismatch");
  }
  if (normalised.state.agentTokens.some((token) => "token_hash" in token)) {
    throw new Error("invalid artifact: credential material is not permitted");
  }
  return normalised;
}

function insertRows(raw: Database.Database, table: TableName | "sqlite_sequence", records: Row[]): void {
  if (records.length === 0) return;
  const columns = Object.keys(records[0]);
  if (records.some((row) => Object.keys(row).length !== columns.length || columns.some((column) => !(column in row)))) {
    throw new Error(`invalid artifact: inconsistent ${table} row shape`);
  }
  const statement = raw.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
  for (const row of records) statement.run(...columns.map((column) => row[column]));
}

function inactiveTokenHash(): string {
  return randomBytes(32).toString("hex");
}

function assertEmptyDestination(path: string): void {
  if (existsSync(path)) throw new Error(`refusing to overwrite destination database: ${path}`);
}

/** Import only into a new file. Existing files are never overwritten. */
export function importWorkspaceState(destinationPath: string, value: unknown): WorkspaceStateArtifact {
  const artifact = validateWorkspaceStateArtifact(value);
  const destination = resolve(destinationPath);
  assertEmptyDestination(destination);
  mkdirSync(dirname(destination), { recursive: true });
  const { raw } = createDb(destination);
  try {
    raw.transaction(() => {
      raw.exec(`
        DELETE FROM notification_outbox;
        DELETE FROM agent_tokens;
        DELETE FROM issue_questions;
        DELETE FROM dependencies;
        DELETE FROM issue_labels;
        DELETE FROM issues;
        DELETE FROM labels;
        DELETE FROM projects;
        DELETE FROM registration_settings;
        DELETE FROM users;
        DELETE FROM sqlite_sequence;
      `);
      insertRows(raw, "users", artifact.state.users);
      insertRows(raw, "registration_settings", artifact.state.registrationSettings);
      insertRows(raw, "projects", artifact.state.projects);
      insertRows(raw, "labels", artifact.state.labels);
      const tokens = artifact.state.agentTokens.map((token) => ({
        ...token,
        token_hash: inactiveTokenHash(),
      }));
      insertRows(raw, "agent_tokens", tokens);
      insertRows(raw, "notification_outbox", artifact.state.notificationOutbox);
      insertRows(raw, "issues", artifact.state.issues);
      insertRows(raw, "issue_labels", artifact.state.issueLabels);
      insertRows(raw, "dependencies", artifact.state.dependencies);
      insertRows(raw, "issue_questions", artifact.state.issueQuestions);
      // Row inserts repopulate SQLite's AUTOINCREMENT counters. Replace those
      // rows with the captured high-water marks afterwards so deleted IDs are
      // not accidentally reused after cutover.
      raw.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${TABLES.map(() => "?").join(",")})`).run(...TABLES);
      insertRows(raw, "sqlite_sequence", artifact.state.sqliteSequences as unknown as Row[]);
    })();
    const foreignKeyProblems = raw.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyProblems.length > 0) throw new Error("import failed foreign-key verification");
    const importedState = readState(raw);
    if (canonicalSha256(importedState) !== artifact.integrity.canonicalSha256) {
      throw new Error("import verification failed: canonical state checksum mismatch");
    }
    raw.close();
    return artifact;
  } catch (error) {
    raw.close();
    rmSync(destination, { force: true });
    throw error;
  }
}

export function verifyWorkspaceState(sourcePath: string, destinationPath: string): {
  sourceCounts: Record<string, number>;
  destinationCounts: Record<string, number>;
  canonicalSha256: string;
} {
  const source = exportWorkspaceState(sourcePath);
  const destination = exportWorkspaceState(destinationPath);
  if (source.integrity.canonicalSha256 !== destination.integrity.canonicalSha256) {
    throw new Error("verification failed: source and destination canonical checksums differ");
  }
  return {
    sourceCounts: source.source.tableCounts,
    destinationCounts: destination.source.tableCounts,
    canonicalSha256: source.integrity.canonicalSha256,
  };
}
