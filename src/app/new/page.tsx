import Link from "next/link";
import { listLabels } from "@/lib/domain";
import { getServerDb } from "@/lib/server-data";
import { NewIssueForm } from "./new-issue-form";
import { AlienIcon } from "@/components/icons";
import { Reveal } from "@/components/reveal";

/**
 * New issue view (/new). Renders a form posting to the createIssueAction server
 * action. The form is a small client island so it can display inline errors
 * returned from the action.
 */
export default async function NewIssuePage() {
  const db = getServerDb();
  const labels = listLabels(db);

  return (
    <div className="max-w-2xl">
      <Link
        href="/"
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
        </h1>
      </Reveal>
      <Reveal delay={80}>
        <div className="glass rounded-2xl p-5">
          <NewIssueForm labels={labels} />
        </div>
      </Reveal>
    </div>
  );
}
