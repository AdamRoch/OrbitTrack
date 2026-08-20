import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHarness } from "./harness";

const h = createHarness();

describe("agent API authentication", () => {
  it("rejects missing and invalid bearer credentials without leaking workspace data", async () => {
    const missing = await h.fetch("/api/issues", { headers: { authorization: "" } });
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: { message: "authentication required", code: "unauthorized" } });

    const invalid = await h.fetch("/api/issues", { headers: { authorization: "Bearer not-a-real-token" } });
    expect(invalid.status).toBe(401);
  });

  it("keeps the normal agent workflow available with the configured credential", async () => {
    const created = await h.createIssue({ title: "authenticated ticket", status: "todo" });
    expect(created.status).toBe(201);
    const frontier = await h.frontier();
    expect(frontier.status).toBe(200);
    expect(frontier.body.map((issue: { identifier: string }) => issue.identifier)).toContain(created.body.identifier);
  });

  it("hides another workspace's projects from an authenticated agent", async () => {
    const adminProject = await h.createProject({ key: "ADMIN", name: "Admin project" });
    expect(adminProject.status).toBe(201);

    const raw = new Database(h.dbPath);
    const now = Date.now();
    const owner = raw.prepare(
      "INSERT INTO users (email, name, is_admin, created_at) VALUES (?, ?, 0, ?)",
    ).run("other@example.test", "Other user", now);
    const otherToken = "other-workspace-token";
    raw.prepare(
      "INSERT INTO agent_tokens (owner_id, token_hash, name, created_at) VALUES (?, ?, ?, ?)",
    ).run(owner.lastInsertRowid, createHash("sha256").update(otherToken).digest("hex"), "test agent", now);
    raw.close();

    const otherHeaders = { authorization: `Bearer ${otherToken}` };
    const otherProject = await h.fetch("/api/projects", {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({ key: "OTHER", name: "Other project" }),
    });
    expect(otherProject.status).toBe(201);

    const adminProjects = await h.listProjects();
    expect(adminProjects.body.map((project: { key: string }) => project.key)).not.toContain("OTHER");

    const crossWorkspace = await h.fetch("/api/issues?project=ADMIN", { headers: otherHeaders });
    expect(crossWorkspace.status).toBe(404);
    await expect(crossWorkspace.json()).resolves.toEqual({ error: { message: "not found", code: "not_found" } });
  });

  it("lets an authenticated browser create projects and manage its agent credentials", async () => {
    const browserHeaders = { authorization: "" };
    const project = await h.fetch("/api/projects", {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ key: "BROWSER", name: "Browser project" }),
    });
    expect(project.status).toBe(201);

    const created = await h.fetch("/api/agent-tokens", {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ name: "browser agent" }),
    });
    expect(created.status).toBe(201);
    const credential = await created.json();
    expect(credential.token).toMatch(/^ot_/);

    const listed = await h.fetch("/api/agent-tokens", { headers: browserHeaders });
    expect(listed.status).toBe(200);
    expect((await listed.json()).some((item: { id: number }) => item.id === credential.id)).toBe(true);
  });
});
