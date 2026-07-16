import { getDb } from "@/lib/db";
import { getFrontier } from "@/lib/domain";
import { handleError, ok } from "@/lib/api";

/**
 * GET /api/issues/frontier
 * Returns issues that are `todo` AND whose every blocker is `done`, ordered
 * priority desc then created asc. This is the load-bearing query for agents.
 */
export async function GET() {
  try {
    const db = getDb();
    return ok(getFrontier(db));
  } catch (err) {
    return handleError(err);
  }
}
