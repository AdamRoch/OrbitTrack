import { listIssues, listProjects } from "@/lib/domain";
import { getServerDb, getServerProject } from "@/lib/server-data";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import { ProjectSwitcher } from "@/components/project-switcher";
import type { GraphIssue } from "@/lib/graph-layout";
import { CometIcon } from "@/components/icons";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";

// The graph reflects live issue data, so render it on every request rather
// than caching a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Dependency-graph view (/map). Renders the active project's issue DAG as an
 * interactive canvas: nodes are issues, edges are "blocks", and the frontier
 * glows. The project switcher (?project=KEY) selects which project to view.
 *
 * The canvas is full-bleed (escapes the `max-w-5xl` main container) so a real
 * graph has room to breathe. The page is a server component that reads the
 * issue list and hands a lean payload to the client canvas island.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const db = getServerDb();

  const projects = listProjects(db);
  const projectKey =
    typeof sp.project === "string" ? sp.project : undefined;
  const project = getServerProject(db, projectKey);

  const issues = project ? listIssues(db, project) : [];

  const graphIssues: GraphIssue[] = issues.map((i) => ({
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    status: i.status,
    priority: i.priority,
    ready: i.ready,
    blockerIssueIds: i.blockerIssueIds,
  }));

  return (
    <div>
      <Reveal>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[--foreground] text-glow">
              Map
              {project && (
                <span className="ml-3 align-middle font-mono text-base text-[--foreground-muted]">
                  {project.key}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-[--foreground-muted]">
              The dependency graph for the selected project.
            </p>
          </div>
          <ProjectSwitcher projects={projects} activeKey={project?.key ?? null} />
        </div>
      </Reveal>

      {project && graphIssues.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 top-32 h-[calc(100vh-8rem)]">
          <GraphCanvas issues={graphIssues} />
        </div>
      ) : (
        <EmptyGraph projectMissing={!project} />
      )}
    </div>
  );
}

function EmptyGraph({ projectMissing }: { projectMissing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[--border] bg-[--surface-2]/60 text-[--accent]">
        <span className="h-2.5 w-2.5 rounded-full bg-[--accent] opacity-80 shadow-[0_0_14px_rgba(var(--glow),0.9)] animate-pulse" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-[--foreground] text-glow">
        {projectMissing ? "No project selected" : "Nothing to map yet"}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-[--foreground-muted]">
        {projectMissing
          ? "Create a project via POST /api/projects, then switch to it."
          : "Create an issue, then link blockers on its detail page. The graph will render every dependency and highlight what is ready to pick up."}
      </p>
      {!projectMissing && (
        <Button asChild variant="primary" size="sm" className="mt-5" icon={<CometIcon className="h-3.5 w-3.5" />}>
          <Link href="/new">New issue</Link>
        </Button>
      )}
    </div>
  );
}
