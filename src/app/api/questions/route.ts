import { getDb } from "@/lib/db";
import { listOpenQuestions } from "@/lib/domain";
import { badRequest, handleError, ok, requireProject } from "@/lib/api";
import { questionStatuses } from "@/lib/db/schema";

const STATUS_SET = new Set<string>(questionStatuses);

/**
 * GET /api/questions?status=open&label=auth&project=KEY
 *
 * The orchestrating model's primary read: every open question across issues,
 * each embedded with the full `IssueDTO` of its parent (including that issue's
 * Q&A history) so the answering model gets prior exchanges as context in one
 * fetch.
 *
 *   - `status` filters the derived question state. Defaults to `open` (the only
 *     value currently returned — the orchestrator polls "what needs answering").
 *     An unrecognized value is a 400.
 *   - `label` restricts to issues carrying that label (a "track": the topical
 *     scope of one QA agent). Mirrors `GET /api/issues?label=`.
 *   - `project` restricts to issues in that project scope. When omitted, open
 *     questions from ALL projects are returned (the cross-project orchestrator
 *     view) — answering agents typically scope themselves with `label`.
 */
export async function GET(req: Request) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "open";
    const label = url.searchParams.get("label") ?? undefined;
    const projectKey = url.searchParams.get("project") ?? undefined;

    if (!STATUS_SET.has(status)) {
      return badRequest(
        `status must be one of: ${questionStatuses.join(", ")}`,
        "invalid_status",
      );
    }

    // `project` is optional here (unlike /api/issues where it has a default).
    // An empty/unknown value is a 400 via requireProject's validation path.
    const project = projectKey ? requireProject(db, url) : undefined;

    // Only `open` is materialized today; the query returns open questions.
    const entries = listOpenQuestions(db, label, project);
    return ok(entries);
  } catch (err) {
    return handleError(err);
  }
}
