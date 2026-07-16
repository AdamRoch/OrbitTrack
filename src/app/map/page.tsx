import { listIssues } from "@/lib/domain";
import { getServerDb } from "@/lib/server-data";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import type { GraphIssue } from "@/lib/graph-layout";
import { CometIcon } from "@/components/icons";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// The graph reflects live issue data, so render it on every request rather
// than caching a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Dependency-graph view (/map). Renders the full issue DAG as an interactive
 * canvas: nodes are issues, edges are "blocks", and the frontier glows. This is
 * the page that makes the tracker's thesis — the dependency graph + the
 * frontier — visible at a glance.
 *
 * The canvas is full-bleed (escapes the `max-w-5xl` main container) so a real
 * graph has room to breathe. The page is a server component that reads the
 * issue list and hands a lean payload to the client canvas island.
 */
export default async function MapPage() {
  const db = getServerDb();
  const issues = listIssues(db);

  const graphIssues: GraphIssue[] = issues.map((i) => ({
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    status: i.status,
    priority: i.priority,
    ready: i.ready,
    blockerIssueIds: i.blockerIssueIds,
  }));

  if (graphIssues.length === 0) {
    return <EmptyGraph />;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-20 h-[calc(100vh-5rem)]">
      <GraphCanvas issues={graphIssues} />
    </div>
  );
}

function EmptyGraph() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[--border] bg-[--surface-2]/60 text-[--accent]">
        <span className="h-2.5 w-2.5 rounded-full bg-[--accent] opacity-80 shadow-[0_0_14px_rgba(var(--glow),0.9)] animate-pulse" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-[--foreground] text-glow">Nothing to map yet</h1>
      <p className="mt-2 max-w-sm text-sm text-[--foreground-muted]">
        Create an issue, then link blockers on its detail page. The graph will
        render every dependency and highlight what is ready to pick up.
      </p>
      <Button asChild variant="primary" size="sm" className="mt-5" icon={<CometIcon className="h-3.5 w-3.5" />}>
        <Link href="/new">New issue</Link>
      </Button>
    </div>
  );
}
