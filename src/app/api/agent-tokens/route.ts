import { createAgentToken, listAgentTokens } from "@/lib/db";
import { handleError, ok, parseJson, requireWorkspacePrincipal } from "@/lib/api";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const db = getDb();
    return ok(listAgentTokens((await requireWorkspacePrincipal(req, db)).ownerId));
  } catch (error) { return handleError(error); }
}

export async function POST(req: Request) {
  try {
    const db = getDb();
    const principal = await requireWorkspacePrincipal(req, db);
    const body = await parseJson<{ name?: unknown }>(req);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "agent";
    return ok(createAgentToken(principal.ownerId, name), 201);
  } catch (error) { return handleError(error); }
}
