import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, provisionGoogleUserOnDatabase } from "@/lib/db";

const dirs: string[] = [];

function databaseWithCap(cap = 10) {
  const dir = mkdtempSync(join(tmpdir(), "orbittrack-registration-"));
  dirs.push(dir);
  const { raw } = createDb(join(dir, "tracker.db"));
  raw.prepare("UPDATE registration_settings SET account_cap = ? WHERE id = 1").run(cap);
  return raw;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("self-service registration", () => {
  it("creates one empty workspace owner and reuses it on repeat sign-in", () => {
    const raw = databaseWithCap();
    const first = provisionGoogleUserOnDatabase(raw, "new@example.test", "google-subject-1", "New user");
    const repeat = provisionGoogleUserOnDatabase(raw, "new@example.test", "google-subject-1", "Renamed user");
    expect(first.kind).toBe("created");
    expect(repeat.kind).toBe("existing");
    expect(raw.prepare("SELECT count(*) AS n FROM users WHERE email = 'new@example.test'").get()).toEqual({ n: 1 });
    expect(raw.prepare("SELECT count(*) AS n FROM projects WHERE owner_id = (SELECT id FROM users WHERE email = 'new@example.test')").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT active_account_count FROM registration_settings WHERE id = 1").get()).toEqual({ active_account_count: 1 });
    raw.close();
  });

  it("enforces the cap atomically at the database boundary", async () => {
    const raw = databaseWithCap(2);
    const attempts = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      Promise.resolve(provisionGoogleUserOnDatabase(raw, `user${index}@example.test`, `subject-${index}`, null)),
    ));
    expect(attempts.filter((result) => result.kind === "created")).toHaveLength(2);
    expect(attempts.filter((result) => result.kind === "full")).toHaveLength(2);
    expect(raw.prepare("SELECT count(*) AS n FROM users WHERE is_admin = 0").get()).toEqual({ n: 2 });
    raw.close();
  });

  it("denies new accounts while closed but never locks out existing accounts", () => {
    const raw = databaseWithCap();
    expect(provisionGoogleUserOnDatabase(raw, "member@example.test", "member-subject", null).kind).toBe("created");
    raw.prepare("UPDATE registration_settings SET registrations_open = 0 WHERE id = 1").run();
    expect(provisionGoogleUserOnDatabase(raw, "member@example.test", "member-subject", null).kind).toBe("existing");
    expect(provisionGoogleUserOnDatabase(raw, "new@example.test", "new-subject", null).kind).toBe("closed");
    expect(raw.prepare("SELECT count(*) AS n FROM users WHERE is_admin = 0").get()).toEqual({ n: 1 });
    raw.close();
  });
});
