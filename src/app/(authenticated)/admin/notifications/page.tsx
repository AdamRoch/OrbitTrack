import { redirect } from "next/navigation";
import { getBrowserSession } from "@/lib/auth";
import { listNotificationOutbox } from "@/lib/db";
import { deliverPendingNotifications } from "@/lib/notifications";

export default async function NotificationOutboxPage() {
  const session = await getBrowserSession();
  if (!session) redirect("/api/auth/signin");
  if (!session.user.isAdmin) redirect("/");
  await deliverPendingNotifications();
  const rows = listNotificationOutbox();
  return <section className="mx-auto max-w-3xl pt-12"><span className="eyebrow">Platform administration</span><h1 className="mt-3 text-3xl font-semibold text-[--foreground]">Registration emails</h1><p className="mt-2 text-sm text-[--foreground-muted]">Pending and retrying messages are attempted when this page is opened.</p><div className="glass-core mt-8 overflow-hidden rounded-3xl ring-1 ring-[--border]"><table className="w-full text-left text-sm"><thead className="text-[--foreground-muted]"><tr><th className="p-4">Workspace owner</th><th>Status</th><th>Attempts</th><th className="p-4">Created</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-[--border]"><td className="p-4">{row.ownerName ?? row.ownerEmail}<br /><span className="text-xs text-[--foreground-muted]">{row.ownerEmail}</span></td><td>{row.status}</td><td>{row.attempts}</td><td className="p-4 text-xs text-[--foreground-muted]">{new Date(row.createdAt).toLocaleString()}</td></tr>)}{rows.length === 0 && <tr><td className="p-4 text-[--foreground-muted]" colSpan={4}>No registration emails yet.</td></tr>}</tbody></table></div></section>;
}
