import { getDb } from "@/lib/db";
import { setIssueLabels } from "@/lib/domain";
import {
  handleError,
  notFound,
  ok,
  parseJson,
  requireProject,
  RouteContext,
} from "@/lib/api";
import { parseLabelNames } from "@/lib/validate";

interface SetLabelsBody {
  labelNames?: unknown;
}

/**
 * PUT /api/issues/:id/labels?project=KEY
 *   Full replacement: the issue's label set becomes exactly `labelNames`.
 *   Unknown label names return 400 (this endpoint does not create labels).
 *   Resolution is project-scoped. Labels themselves are global across projects
 *   in the lean view-only model.
 */
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const project = requireProject(db, url);
    const { id } = await ctx.params;
    const body = await parseJson<SetLabelsBody>(req);

    const labelNames = parseLabelNames(body.labelNames);

    const updated = setIssueLabels(db, project, id, labelNames);
    if (!updated) return notFound("issue not found");
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}
