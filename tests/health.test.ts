import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { resetDbCache } from "@/lib/db";

const originalPath = process.env.TRACKER_DB_PATH;
let temporaryDirectory: string | null = null;

afterEach(() => {
  resetDbCache();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
  if (originalPath === undefined) delete process.env.TRACKER_DB_PATH;
  else process.env.TRACKER_DB_PATH = originalPath;
});

describe("database readiness", () => {
  it("returns a data-free success response once the configured datastore is usable", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "orbittrack-health-"));
    process.env.TRACKER_DB_PATH = join(temporaryDirectory, "tracker.db");
    resetDbCache();
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returns a safe unavailable response when the configured datastore cannot be opened", async () => {
    process.env.TRACKER_DB_PATH = "/dev/null/orbittrack.db";
    resetDbCache();
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
