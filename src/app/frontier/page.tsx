import { getFrontier } from "@/lib/domain";
import { getServerDb } from "@/lib/server-data";
import { IssueRow } from "@/components/issue-display";
import { CometIcon } from "@/components/icons";
import { Reveal } from "@/components/reveal";

/**
 * Frontier view (/frontier). The set of `todo` issues whose every blocker is
 * `done` — i.e. what an agent (or human) can grab right now. This is the page
 * the PRD calls "the single highest-value capability."
 */
export default async function FrontierPage() {
  const db = getServerDb();
  const frontier = getFrontier(db);

  return (
    <div>
      <Reveal>
        <div className="mb-5">
          <span className="eyebrow">
            <CometIcon className="h-3 w-3" />
            Ready for contact
          </span>
          <h1 className="mt-3 flex items-center gap-2 text-3xl font-semibold tracking-tight text-[--foreground] text-glow">
            Frontier
          </h1>
          <p className="mt-1 text-sm text-[--foreground-muted]">
            Issues that are <code className="text-xs text-[--accent]">todo</code> and whose every
            blocker is <code className="text-xs text-[--accent]">done</code>. Ready to pick up.
          </p>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="glass-bezel">
          <div className="glass-core divide-y divide-[--border] overflow-hidden p-0">
            {frontier.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[--border] bg-[--surface-2]/60 text-[--foreground-subtle]">
                  <CometIcon className="h-5 w-5" />
                </span>
                <p className="text-sm text-[--foreground-muted]">
                  Nothing ready right now.
                </p>
                <p className="text-xs text-[--foreground-subtle] mt-1">
                  Move a blocked issue forward, or mark a blocker done.
                </p>
              </div>
            ) : (
              frontier.map((issue) => <IssueRow key={issue.id} issue={issue} />)
            )}
          </div>
        </div>
      </Reveal>

      <p className="mt-3 text-xs text-[--foreground-subtle] text-right">
        {frontier.length} ready {frontier.length === 1 ? "issue" : "issues"}
      </p>

      <Reveal delay={140}>
        <div className="glass mt-6 rounded-2xl p-4">
          <h2 className="text-sm font-medium mb-1 text-[--foreground]">Agent usage</h2>
          <p className="text-xs text-[--foreground-muted] leading-relaxed">
            Agents fetch the same set via{" "}
            <code className="text-xs text-[--accent]">GET /api/issues/frontier</code>, then atomically
            claim one with{" "}
            <code className="text-xs text-[--accent]">
              POST /api/issues/&lt;id&gt;/claim
            </code>
            .
          </p>
        </div>
      </Reveal>
    </div>
  );
}
