import Link from "next/link";
import { notFound } from "next/navigation";
import { getIssue, getBlockers, getBlockedBy, listLabels } from "@/lib/domain";
import { getServerDb } from "@/lib/server-data";
import { renderMarkdown } from "@/lib/markdown";
import {
  BlockedBadge,
  LabelChips,
  PriorityBadge,
  StatusBadge,
} from "@/components/issue-display";
import { IssueDetailForms } from "./issue-detail-forms";
import { AlienIcon, RadarIcon, SignalIcon } from "@/components/icons";
import { Reveal } from "@/components/reveal";
import { QATranscript } from "@/components/qa-transcript";

/**
 * Detail view (/issues/:identifier). Full title, rendered markdown, status &
 * priority controls, label chips, and the blocker / blocked-by lists with
 * add/remove controls. All mutations go through server actions.
 */
export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const db = getServerDb();

  const issue = getIssue(db, identifier);
  if (!issue) notFound();

  const [blockers, blockedBy, allLabels, descriptionHtml] = await Promise.all([
    getBlockers(db, identifier) ?? [],
    getBlockedBy(db, identifier) ?? [],
    Promise.resolve(listLabels(db)),
    renderMarkdown(issue.description),
  ]);

  return (
    <div className="max-w-3xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs text-[--foreground-muted] hover:text-[--foreground] mb-4 transition-colors"
      >
        <span className="rotate-180">→</span>
        Back to issues
      </Link>

      <Reveal>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-mono text-sm text-[--foreground-subtle]">
            {issue.identifier}
          </span>
          <StatusBadge status={issue.status} />
          <BlockedBadge issue={issue} />
          <PriorityBadge priority={issue.priority} />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-[--foreground] text-glow mb-3">
          {issue.title}
        </h1>
      </Reveal>

      {issue.labels.length > 0 && (
        <div className="mb-5">
          <LabelChips labels={issue.labels} />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        {/* Main column: description + edit form */}
        <div className="space-y-6">
          <section>
            <h2 className="eyebrow mb-3">
              <AlienIcon className="h-3 w-3" />
              Description
            </h2>
            {descriptionHtml ? (
              <div
                className="glass rounded-2xl p-4 text-sm text-[--foreground] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ) : (
              <p className="text-sm text-[--foreground-subtle] italic">
                No description provided.
              </p>
            )}
          </section>

          <QATranscript questions={issue.questions} />

          <Reveal>
            <IssueDetailForms
              issue={issue}
              allLabels={allLabels}
              blockers={blockers}
              blockedBy={blockedBy}
            />
          </Reveal>
        </div>

        {/* Sidebar: dependencies */}
        <aside className="space-y-5">
          <DependencyList
            title="Blocked by"
            icon={<RadarIcon className="h-3.5 w-3.5" />}
            issues={blockers}
            emptyText="No blockers. Ready when status is todo."
          />
          <DependencyList
            title="Blocks"
            icon={<SignalIcon className="h-3.5 w-3.5" />}
            issues={blockedBy}
            emptyText="Nothing depends on this issue."
          />
          <div className="glass rounded-2xl p-3 text-xs text-[--foreground-subtle] space-y-1">
            <div>
              Created{" "}
              <time dateTime={issue.createdAt}>
                {new Date(issue.createdAt).toLocaleString()}
              </time>
            </div>
            <div>
              Updated{" "}
              <time dateTime={issue.updatedAt}>
                {new Date(issue.updatedAt).toLocaleString()}
              </time>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DependencyList({
  title,
  icon,
  issues,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  issues: Awaited<ReturnType<typeof getBlockers>>;
  emptyText: string;
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[--foreground-muted] uppercase tracking-wide">
        {icon}
        {title}
      </h3>
      {issues && issues.length > 0 ? (
        <ul className="space-y-1.5">
          {issues.map((i) => (
            <li key={i.id}>
              <Link
                href={`/issues/${i.identifier}`}
                className="group flex items-center gap-2 rounded-xl border border-[--border] bg-[--surface]/60 px-3 py-2 text-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[--border-strong] hover:bg-[--surface-hover]/80"
              >
                <span className="font-mono text-xs text-[--foreground-subtle]">
                  {i.identifier}
                </span>
                <span className="flex-1 truncate text-[--foreground] group-hover:text-white">
                  {i.title}
                </span>
                <StatusBadge status={i.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[--foreground-subtle]">{emptyText}</p>
      )}
    </div>
  );
}
