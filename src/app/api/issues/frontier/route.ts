import { getDb } from "@/lib/db";
import { getFrontier } from "@/lib/domain";
import { handleError, ok, requireProject } from "@/lib/api";

/**
 * GET /api/issues/frontier?project=KEY
 *   Returns issues in the active project scope that are `todo` AND whose every
 *   blocker is `done`, ordered priority desc then created asc. This is the
 *   load-bearing query for agents. When `?project=KEY` is omitted, the default
 *   project is used.
 */
export async function GET(req: Request) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const project = requireProject(db, url);
    return ok(getFrontier(db, project));
  } catch (err) {
    return handleError(err);
  }
}
