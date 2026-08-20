import { RESEND_API_KEY, RESEND_FROM, ADMIN_EMAIL } from "./config";
import { getRawDb } from "./db";

type OutboxRow = { id: number; dedupe_key: string; owner_email: string; owner_name: string | null; created_at: number; attempts: number };

const SENDING_LEASE_MS = 5 * 60 * 1000;

export async function deliverPendingNotifications(fetcher: typeof fetch = fetch): Promise<void> {
  if (!RESEND_API_KEY || !ADMIN_EMAIL) return;
  const db = getRawDb();
  const now = Date.now();
  const leaseExpiredAt = now - SENDING_LEASE_MS;
  const rows = db.prepare("SELECT id, dedupe_key, owner_email, owner_name, created_at, attempts FROM notification_outbox WHERE (status IN ('pending','retry') AND next_attempt_at <= ?) OR (status = 'sending' AND updated_at <= ?) ORDER BY id LIMIT 10").all(now, leaseExpiredAt) as OutboxRow[];
  for (const row of rows) {
    const claim = db.prepare("UPDATE notification_outbox SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND ((status IN ('pending','retry') AND next_attempt_at <= ?) OR (status = 'sending' AND updated_at <= ?)) RETURNING attempts").get(now, row.id, now, leaseExpiredAt) as { attempts: number } | undefined;
    if (!claim) continue;
    try {
      const response = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": row.dedupe_key }, body: JSON.stringify({ from: RESEND_FROM, to: [ADMIN_EMAIL], subject: "New OrbitTrack workspace", html: `<p>A new workspace was created for <strong>${escapeHtml(row.owner_name || row.owner_email)}</strong> (${escapeHtml(row.owner_email)}).</p><p>Created: ${new Date(row.created_at).toISOString()}</p>` }) });
      if (!response.ok) throw new Error(`provider_${response.status}`);
      const body = await response.json().catch(() => ({})) as { id?: string };
      db.prepare("UPDATE notification_outbox SET status = 'delivered', delivered_at = ?, provider_id = ?, updated_at = ?, last_error = NULL WHERE id = ? AND status = 'sending' AND attempts = ?").run(Date.now(), body.id ?? null, Date.now(), row.id, claim.attempts);
    } catch {
      if (claim.attempts > 7) {
        db.prepare("UPDATE notification_outbox SET status = 'failed', updated_at = ?, last_error = 'provider delivery failed after retries' WHERE id = ? AND status = 'sending' AND attempts = ?").run(Date.now(), row.id, claim.attempts);
        continue;
      }
      const delay = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(claim.attempts - 1, 10));
      db.prepare("UPDATE notification_outbox SET status = 'retry', next_attempt_at = ?, updated_at = ?, last_error = 'provider delivery failed' WHERE id = ? AND status = 'sending' AND attempts = ?").run(Date.now() + delay, Date.now(), row.id, claim.attempts);
    }
  }
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c); }
