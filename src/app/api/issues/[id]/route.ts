import { getDb } from "@/lib/db";
import { deleteIssue, getIssue, updateIssue } from "@/lib/domain";
import {
  handleError,
  noContent,
  notFound,
  ok,
  parseJson,
  requireProject,
  RouteContext,
} from "@/lib/api";
import {
  optionalDescription,
  parseOptionalPriority,
  parseOptionalStatus,
  requireTitle,
} from "@/lib/validate";
import type { UpdateIssueInput } from "@/lib/types";

/**
 * GET /api/issues/:id?project=KEY  — `:id` may be the numeric id or the
 * identifier (e.g. LIN-42). Identifier-form lookups are scoped: the prefix
 * must match the active project's key, so an identifier from another project
 * returns 404 (no cross-project leakage).
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const project = requireProject(db, url);
    const { id } = await ctx.params;
    const issue = getIssue(db, project, id);
    if (!issue) return notFound("issue not found");
    return ok(issue);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * PATCH /api/issues/:id?project=KEY  — partial update of
 * title/description/status/priority. Resolution is project-scoped.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const project = requireProject(db, url);
    const { id } = await ctx.params;
    const body = await parseJson<UpdateIssueInput>(req);

    const args: Parameters<typeof updateIssue>[3] = {};
    if (body.title !== undefined) args.title = requireTitle(body.title);
    if (body.description !== undefined) {
      args.description = optionalDescription(body.description);
    }
    if (body.status !== undefined) {
      args.status = parseOptionalStatus(body.status);
    }
    if (body.priority !== undefined) {
      args.priority = parseOptionalPriority(body.priority);
    }

    const updated = updateIssue(db, project, id, args);
    if (!updated) return notFound("issue not found");
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * DELETE /api/issues/:id?project=KEY — removes the issue and (via cascade)
 * its label and dependency rows. Returns 204, or 404 if it never existed or
 * belongs to a different project. Resolution is project-scoped.
 */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const project = requireProject(db, url);
    const { id } = await ctx.params;
    const deleted = deleteIssue(db, project, id);
    if (!deleted) return notFound("issue not found");
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
