import { getDb, revokeAgentToken } from "@/lib/db";
import { handleError, noContent, requireWorkspacePrincipal } from "@/lib/api";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) return new Response(null, { status: 404 });
    const db = getDb();
    const revoked = revokeAgentToken((await requireWorkspacePrincipal(req, db)).ownerId, id);
    return revoked ? noContent() : new Response(null, { status: 404 });
  } catch (error) { return handleError(error); }
}
