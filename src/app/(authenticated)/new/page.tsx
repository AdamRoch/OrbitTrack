import Link from "next/link";
import { listLabels, listProjects } from "@/lib/domain";
import { getServerDb, getActiveProject } from "@/lib/server-data";
import { NewIssueForm } from "@/app/new/new-issue-form";
import { AlienIcon } from "@/components/icons";
import { Reveal } from "@/components/reveal";
import { getBrowserSession } from "@/lib/auth";

/**
 * New ticket view (/new). Renders a form posting to the createIssueAction
 * server action. The form is a small client island so it can display inline
 * errors returned from the action.
 *
 * `?project=KEY` seeds the form's Project picker (and thus which prefix the
 * new ticket's identifier gets). When omitted, the default project is
 * preselected; the picker can override the scope or create a project inline.
 */
export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const db = getServerDb();
  const session = await getBrowserSession();
  if (!session) return null;
  const labels = listLabels(db, session.user.ownerId);
  const projects = listProjects(db, session.user.ownerId);

  const projectKey =
    typeof sp.project === "string" ? sp.project : undefined;
  const project = await getActiveProject(db, projectKey);

  return (
    <div className="max-w-2xl">
      <Link
        href={project ? `/?project=${project.key}` : "/"}
        className="inline-flex items-center gap-1 text-xs text-[--foreground-muted] hover:text-[--foreground] mb-4 transition-colors"
      >
        <span className="rotate-180">→</span>
        Back to tickets
      </Link>
      <Reveal>
        <span className="eyebrow">
          <AlienIcon className="h-3 w-3" />
          Transmit new signal
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[--foreground] text-glow mb-5">
          New ticket
        </h1>
      </Reveal>
      <Reveal delay={80}>
        <div className="glass rounded-2xl p-5">
          <NewIssueForm
            labels={labels}
            projects={projects}
            projectKey={project?.key ?? null}
          />
        </div>
      </Reveal>
    </div>
  );
}
