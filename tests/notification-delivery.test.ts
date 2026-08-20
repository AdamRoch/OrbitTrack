import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];

afterEach(async () => {
  const { resetDbCache } = await import("@/lib/db");
  resetDbCache();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  delete process.env.TRACKER_DB_PATH;
});

describe("notification delivery", () => {
  it("reclaims expired sending work but leaves an active lease alone", async () => {
    process.env.RESEND_API_KEY = "test-resend-key";
    const directory = mkdtempSync(join(tmpdir(), "orbittrack-notifications-"));
    directories.push(directory);
    process.env.TRACKER_DB_PATH = join(directory, "tracker.db");

    const { getRawDb, resetDbCache } = await import("@/lib/db");
    const { deliverPendingNotifications } = await import("@/lib/notifications");
    resetDbCache();
    const db = getRawDb();
    const now = Date.now();
    const insert = db.prepare("INSERT INTO notification_outbox (dedupe_key, owner_email, created_at, status, attempts, next_attempt_at, updated_at) VALUES (?, ?, ?, 'sending', 1, ?, ?)");
    insert.run("workspace-created:stale", "stale@example.test", now, now, now - 5 * 60 * 1000 - 1);
    insert.run("workspace-created:active", "active@example.test", now, now, now);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));

    await deliverPendingNotifications(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ "Idempotency-Key": "workspace-created:stale" });
    expect(db.prepare("SELECT status, attempts FROM notification_outbox WHERE dedupe_key = 'workspace-created:stale'").get())
      .toEqual({ status: "delivered", attempts: 2 });
    expect(db.prepare("SELECT status, attempts FROM notification_outbox WHERE dedupe_key = 'workspace-created:active'").get())
      .toEqual({ status: "sending", attempts: 1 });
  });

  it("ignores stale completion after a newer claim delivers", async () => {
    process.env.RESEND_API_KEY = "test-resend-key";
    const directory = mkdtempSync(join(tmpdir(), "orbittrack-notification-fence-"));
    directories.push(directory);
    process.env.TRACKER_DB_PATH = join(directory, "tracker.db");

    const { getRawDb, resetDbCache } = await import("@/lib/db");
    const { deliverPendingNotifications } = await import("@/lib/notifications");
    resetDbCache();
    const db = getRawDb();
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    db.prepare("INSERT INTO notification_outbox (dedupe_key, owner_email, created_at, status, attempts, next_attempt_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)")
      .run("workspace-created:fenced", "fenced@example.test", now, now, now);

    let rejectStale!: (reason?: unknown) => void;
    let markStaleStarted!: () => void;
    const staleStarted = new Promise<void>((resolve) => { markStaleStarted = resolve; });
    const staleRequest = new Promise<Response>((_resolve, reject) => { rejectStale = reject; });
    const fetcher = vi.fn()
      .mockImplementationOnce(() => {
        markStaleStarted();
        return staleRequest;
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "newer-email" }), { status: 200 }));

    const staleDelivery = deliverPendingNotifications(fetcher);
    await staleStarted;
    now += 5 * 60 * 1000 + 1;
    await deliverPendingNotifications(fetcher);
    rejectStale(new Error("stale provider failure"));
    await staleDelivery;

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT status, attempts, provider_id, last_error FROM notification_outbox WHERE dedupe_key = 'workspace-created:fenced'").get())
      .toEqual({ status: "delivered", attempts: 2, provider_id: "newer-email", last_error: null });
  });
});
