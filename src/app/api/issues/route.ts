import { getDb } from "@/lib/db";
import { listIssues, createIssue } from "@/lib/domain";
import {
  handleError,
  ok,
  parseJson,
  requireProject,
} from "@/lib/api";
import {
  parseLabelNames,
  parseOptionalPriority,
  parseOptionalStatus,
  parsePriority,
  parseStatus,
  requireTitle,
  optionalDescription,
} from "@/lib/validate";
import type { CreateIssueInput } from "@/lib/types";

/**
 * GET /api/issues?project=KEY&status=todo&priority=2&label=ready-for-agent
 *
 * Returns all issues in the active project scope matching the (optional)
 * filters. `?project=KEY` selects the project (its key is the identifier
 * prefix, e.g. `LIN`); when omitted, the default project (first by id) is
 * used. To list issues across every project, call this once per project key.
 */
export async function GET(req: Request) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const project = requireProject(db, url);

    const status = url.searchParams.get("status") ?? undefined;
    const priorityParam = url.searchParams.get("priority");
    const label = url.searchParams.get("label") ?? undefined;

    let priority: ReturnType<typeof parsePriority> | undefined;
    // Validate priority from the query string; reject bad values loudly.
    if (priorityParam !== null) priority = parsePriority(priorityParam);

    const filters: Parameters<typeof listIssues>[2] = {};
    if (status) filters.status = parseStatus(status);
    if (priority !== undefined) filters.priority = priority;
    if (label) filters.label = label;

    const issues = listIssues(db, project, filters);
    return ok(issues);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/issues?project=KEY
 *   { title, description?, status?, priority?, labelNames?[] }
 *
 * Creates an issue in the active project scope. The new issue gets that
 * project's prefix and the next per-project number — so under project `OEMR`
 * the response identifier is `OEMR-N`. When `?project=KEY` is omitted, the
 * default project is used (backward-compatible with the single-project API).
 */
export async function POST(req: Request) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const project = requireProject(db, url);
    const body = await parseJson<CreateIssueInput>(req);

    const title = requireTitle(body.title);
    const description = optionalDescription(body.description);
    const status = parseOptionalStatus(body.status);
    const priority = parseOptionalPriority(body.priority);
    const labelNames = parseLabelNames(body.labelNames);

    const issue = createIssue(db, project, {
      title,
      description,
      status,
      priority,
      labelNames,
    });
    return ok(issue, 201);
  } catch (err) {
    return handleError(err);
  }
}
