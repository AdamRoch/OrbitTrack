import { getDb } from "@/lib/db";
import { createLabel, listLabels } from "@/lib/domain";
import { handleError, ok, parseJson, requireAgentPrincipal } from "@/lib/api";
import { parseColor, parseLabelName } from "@/lib/validate";
import type { CreateLabelInput } from "@/lib/types";

/**
 * GET /api/labels — all labels, sorted by name.
 */
export async function GET(req: Request) {
  try {
    const db = getDb();
    return ok(listLabels(db, requireAgentPrincipal(req, db).ownerId));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/labels  { name, color? }
 * Create a label. Color is optional (#6b7280 default). Duplicate name → 400.
 */
export async function POST(req: Request) {
  try {
    const db = getDb();
    const principal = requireAgentPrincipal(req, db);
    const body = await parseJson<CreateLabelInput>(req);

    const name = parseLabelName(body.name);
    const color = parseColor(body.color);

    const label = createLabel(db, { ownerId: principal.ownerId, name, color });
    return ok(label, 201);
  } catch (err) {
    return handleError(err);
  }
}
