import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb, provisionGoogleUserOnDatabase } from "@/lib/db";
import { createIssue } from "@/lib/domain";
import { labels, projects } from "@/lib/db/schema";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("label workspace isolation", () => {
  it("does not attach another workspace's same-named label on issue creation", () => {
    const directory = mkdtempSync(join(tmpdir(), "orbittrack-label-isolation-"));
    directories.push(directory);
    const { db, raw } = createDb(join(directory, "tracker.db"));
    const owner = provisionGoogleUserOnDatabase(raw, "owner@example.test", "owner-subject", "Owner");
    expect(owner.kind).toBe("created");
    if (owner.kind !== "created") throw new Error("workspace owner was not created");
    raw.prepare("INSERT INTO projects (owner_id, key, name, next_number, created_at) VALUES (?, 'OWN', 'Owner', 0, ?)")
      .run(owner.user.id, Date.now());
    raw.prepare("INSERT INTO labels (owner_id, name, color) VALUES (?, 'shared', '#111111')").run(1);
    const project = db.select().from(projects).where(eq(projects.ownerId, owner.user.id)).get();
    if (!project) throw new Error("workspace project was not created");

    const issue = createIssue(db, project, { title: "isolated", description: null, labelNames: ["shared"] });

    expect(issue.labels).toEqual([]);
    expect(db.select().from(labels).where(eq(labels.ownerId, owner.user.id)).all()).toEqual([]);
    raw.close();
  });
});
