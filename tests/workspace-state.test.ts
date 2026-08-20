import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  exportWorkspaceState,
  importWorkspaceState,
  validateWorkspaceStateArtifact,
  verifyWorkspaceState,
} from "@/lib/workspace-state";
import { createDb } from "@/lib/db";

const directories: string[] = [];

function fixture(): { source: string; destination: string } {
  const dir = mkdtempSync(join(tmpdir(), "orbittrack-workspace-state-"));
  directories.push(dir);
  const source = join(dir, "source.db");
  const { raw } = createDb(source);
  const now = 1_700_000_000_000;
  raw.prepare("INSERT INTO users (id, google_subject, email, name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(41, "google-member", "member@example.test", "Member", 0, now);
  raw.prepare("INSERT INTO projects (id, owner_id, key, name, next_number, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(20, 41, "MEM", "Member work", 8, now);
  raw.prepare("INSERT INTO labels (id, owner_id, name, color) VALUES (?, ?, ?, ?)")
    .run(30, 41, "migration", "#2563eb");
  raw.prepare("INSERT INTO issues (id, number, identifier, project_id, title, description, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(50, 8, "MEM-8", 20, "Keep this ticket", "portable", "in_progress", 3, now, now + 1);
  raw.prepare("INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)").run(50, 30);
  raw.prepare("INSERT INTO issue_questions (id, issue_id, number, question, answer, created_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(60, 50, 1, "Where did it go?", "Postgres next.", now, now + 2);
  raw.prepare("INSERT INTO notification_outbox (id, dedupe_key, owner_email, owner_name, created_at, status, attempts, next_attempt_at, delivered_at, provider_id, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(70, "workspace-created:41", "member@example.test", "Member", now, "retry", 2, now + 100, null, null, "temporary", now + 3);
  raw.close();
  return { source, destination: join(dir, "nested", "destination.db") };
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("portable workspace state", () => {
  it("round-trips multi-workspace state, sequences, and durable notification state", () => {
    const { source, destination } = fixture();
    const artifact = exportWorkspaceState(source);

    expect(artifact.state.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 41, email: "member@example.test" }),
    ]));
    expect(artifact.state.agentTokens.every((token) => !("token_hash" in token))).toBe(true);
    expect(artifact.state.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 70, status: "retry", attempts: 2, last_error: "temporary" }),
    ]));

    importWorkspaceState(destination, artifact);
    expect(verifyWorkspaceState(source, destination)).toEqual({
      sourceCounts: artifact.source.tableCounts,
      destinationCounts: artifact.source.tableCounts,
      canonicalSha256: artifact.integrity.canonicalSha256,
    });

    const imported = new Database(destination);
    expect(imported.prepare("SELECT next_number FROM projects WHERE id = 20").get()).toEqual({ next_number: 8 });
    expect(imported.prepare("SELECT status, attempts, last_error FROM notification_outbox WHERE id = 70").get())
      .toEqual({ status: "retry", attempts: 2, last_error: "temporary" });
    const knownBootstrapHash = createHash("sha256").update("orbittrack-test-token").digest("hex");
    const importedToken = imported.prepare("SELECT token_hash FROM agent_tokens WHERE id = 1").get() as { token_hash: string };
    expect(importedToken.token_hash).not.toBe(knownBootstrapHash);
    expect(importedToken.token_hash).not.toBe(
      createHash("sha256").update("orbittrack-imported-agent-token:1").digest("hex"),
    );
    imported.close();
  });

  it("rejects corrupt, incomplete, and overwrite artifacts without leaving a target database", () => {
    const { source, destination } = fixture();
    const artifact = exportWorkspaceState(source);
    const corrupt = structuredClone(artifact);
    corrupt.state.issues[0].title = "tampered";
    expect(() => validateWorkspaceStateArtifact(corrupt)).toThrow("integrity checksum mismatch");
    expect(() => importWorkspaceState(destination, corrupt)).toThrow("integrity checksum mismatch");
    expect(existsSync(destination)).toBe(false);

    const incomplete = structuredClone(artifact) as Record<string, unknown>;
    delete (incomplete.state as Record<string, unknown>).users;
    expect(() => validateWorkspaceStateArtifact(incomplete)).toThrow("incomplete state tables");

    importWorkspaceState(destination, artifact);
    expect(() => importWorkspaceState(destination, artifact)).toThrow("refusing to overwrite");
  });
});
