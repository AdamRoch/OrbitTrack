import { getDb } from "@/lib/db";
import { createProject, listProjects } from "@/lib/domain";
import { handleError, ok, parseJson } from "@/lib/api";
import { parseProjectKey, parseProjectName } from "@/lib/validate";
import type { CreateProjectInput } from "@/lib/types";

/**
 * GET /api/projects
 *   Returns every project, ordered by id (the default project — the lowest id
 *   — first). Use this to populate the project switcher in the UI or to
 *   discover the available identifier prefixes.
 */
export async function GET() {
  try {
    const db = getDb();
    return ok(listProjects(db));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/projects  { key, name? }
 *   Create a project. `key` is the identifier prefix — 1–10 ASCII letters,
 *   stored uppercased. `name` defaults to the key. Duplicate key → 400.
 *
 *   Example: `POST /api/projects { "key": "OEMR", "name": "OpenEMR" }` creates
 *   a project whose first issue will be `OEMR-1`.
 */
export async function POST(req: Request) {
  try {
    const db = getDb();
    const body = await parseJson<CreateProjectInput>(req);
    const key = parseProjectKey(body.key);
    const name = body.name === undefined ? key : parseProjectName(body.name);
    const project = createProject(db, { key, name });
    return ok(project, 201);
  } catch (err) {
    return handleError(err);
  }
}
