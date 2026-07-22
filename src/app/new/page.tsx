import Link from "next/link";
import { listLabels } from "@/lib/domain";
import { getServerDb, getServerProject } from "@/lib/server-data";
import { NewIssueForm } from "./new-issue-form";
import { AlienIcon } from "@/components/icons";
import { Reveal } from "@/components/reveal";

/**
 * New issue view (/new). Renders a form posting to the createIssueAction
 * server action. The form is a small client island so it can display inline
 * errors returned from the action.
 *
 * `?project=KEY` selects which project the new issue is created under (and
 * thus which prefix its identifier gets). When omitted, the default project
 * is used.
 */
export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const db = getServerDb();
  const labels = listLabels(db);

  const projectKey =
    typeof sp.project === "string" ? sp.project : undefined;
  const project = getServerProject(db, projectKey);

  return (
    <div className="max-w-2xl">
      <Link
        href={project ? `/?project=${project.key}` : "/"}
        className="inline-flex items-center gap-1 text-xs text-[--foreground-muted] hover:text-[--foreground] mb-4 transition-colors"
      >
        <span className="rotate-180">→</span>
        Back to issues
      </Link>
      <Reveal>
        <span className="eyebrow">
          <AlienIcon className="h-3 w-3" />
          Transmit new signal
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[--foreground] text-glow mb-5">
          New issue
          {project && (
            <span className="ml-3 align-middle font-mono text-base text-[--foreground-muted]">
              {project.key}
            </span>
          )}
        </h1>
      </Reveal>
      <Reveal delay={80}>
        <div className="glass rounded-2xl p-5">
          {project ? (
            <NewIssueForm labels={labels} projectKey={project.key} />
          ) : (
            <p className="text-sm text-[--foreground-muted]">
              No projects exist yet. Create one via{" "}
              <code className="text-xs text-[--accent]">POST /api/projects</code>{" "}
              before creating an issue.
            </p>
          )}
        </div>
      </Reveal>
    </div>
  );
}
