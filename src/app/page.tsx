import Link from "next/link";
import { listIssues, listLabels, listProjects } from "@/lib/domain";
import { getServerDb, getServerProject } from "@/lib/server-data";
import { IssueRow } from "@/components/issue-display";
import { FilterBar } from "@/components/filter-bar";
import { ProjectSwitcher } from "@/components/project-switcher";
import type { IssueStatus, Priority } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { CometIcon, StarIcon } from "@/components/icons";
import { Reveal } from "@/components/reveal";

/**
 * List view (/). Table of all issues with filter controls driven by query
 * params (status, priority, label) and a project switcher driven by
 * ?project=KEY. The list itself is fully server-rendered; only the filter
 * selects and the project switcher are tiny client islands.
 */
export default async function IssuesPage({
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

  const labels = listLabels(db);

  const status = typeof sp.status === "string" ? (sp.status as IssueStatus) : undefined;
  const priorityRaw = typeof sp.priority === "string" ? sp.priority : undefined;
  const priority =
    priorityRaw !== undefined && /^\d+$/.test(priorityRaw)
      ? (Number(priorityRaw) as Priority)
      : undefined;
  const label = typeof sp.label === "string" ? sp.label : undefined;

  const issues = project
    ? listIssues(db, project, { status, priority, label })
    : [];
  const hasFilters = Boolean(status || priorityRaw || label);

  return (
    <div>
      <Reveal>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
          <div>
            <span className="eyebrow">
              <StarIcon className="h-3 w-3" />
              Mission log
            </span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[--foreground] text-glow">
              Issues
              {project && (
                <span className="ml-3 align-middle font-mono text-base text-[--foreground-muted]">
                  {project.key}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-[--foreground-muted]">
              Every signal in the tracker, ready to be triaged.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <ProjectSwitcher projects={projects} activeKey={project?.key ?? null} />
            <Button asChild variant="primary" size="md" icon={<CometIcon className="h-3.5 w-3.5" />}>
              <Link href={project ? `/new?project=${project.key}` : "/new"}>
                New issue
              </Link>
            </Button>
          </div>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <FilterBar labels={labels} current={{ status, priority, label }} />
      </Reveal>

      <Reveal delay={140}>
        <div className="ticket-panel rounded-[1.75rem] p-1.5">
          <div className="glass-core divide-y divide-[--border] overflow-hidden p-0">
            {!project ? (
              <EmptyState hasFilters={false} noProjects />
            ) : issues.length === 0 ? (
              <EmptyState hasFilters={hasFilters} />
            ) : (
              issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))
            )}
          </div>
        </div>
      </Reveal>

      <p className="mt-3 text-xs text-[--foreground-subtle] text-right">
        {issues.length} {issues.length === 1 ? "issue" : "issues"}
      </p>
    </div>
  );
}

function EmptyState({ hasFilters, noProjects }: { hasFilters: boolean; noProjects?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[--border] bg-[--surface-2]/60 text-[--foreground-subtle]">
        <StarIcon className="h-5 w-5" />
      </span>
      <p className="text-sm text-[--foreground-muted]">
        {noProjects
          ? "No projects yet. Create one via POST /api/projects."
          : hasFilters
            ? "No issues match these filters."
            : "No issues yet. Create your first one."}
      </p>
      {!hasFilters && !noProjects && (
        <Button asChild variant="secondary" size="sm" className="mt-4" icon={<CometIcon className="h-3.5 w-3.5" />}>
          <Link href="/new">New issue</Link>
        </Button>
      )}
    </div>
  );
}
