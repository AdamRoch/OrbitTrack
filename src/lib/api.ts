import { NextResponse } from "next/server";
import type { DB } from "./db";
import { getDefaultProjectForOwner, getProjectByKeyForOwner, findActiveAgentByToken } from "./db";
import type { ProjectRow } from "./db/schema";
import type { ApiErrorBody } from "./types";
import { ValidationError } from "./validate";
import { getBrowserSession } from "./auth";

/**
 * Shared HTTP helpers for the REST API. Every response goes through these so
 * the JSON shapes (success + the canonical error envelope) stay uniform —
 * which is what makes the API a reliable contract for agents.
 */

/** 200/201 with a JSON body. */
export function ok<T>(body: T, status: 200 | 201 = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/** 204 No Content. */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Build the canonical error envelope: `{ error: { message, code } }`. */
export function errorBody(message: string, code: string | null = null): ApiErrorBody {
  return { error: { message, code } };
}

/** 400 with the canonical error shape. */
export function badRequest(message: string, code: string | null = null): NextResponse {
  return NextResponse.json(errorBody(message, code), { status: 400 });
}

/** 404 with the canonical error shape. */
export function notFound(message = "not found"): NextResponse {
  return NextResponse.json(errorBody(message, "not_found"), { status: 404 });
}

/** 409 with the canonical error shape. */
export function conflict(message: string, code: string | null = null): NextResponse {
  return NextResponse.json(errorBody(message, code), { status: 409 });
}

export function unauthorized(): NextResponse {
  return NextResponse.json(errorBody("authentication required", "unauthorized"), { status: 401 });
}

class AuthenticationError extends Error {}
class ProjectNotFoundError extends Error {}

/**
 * Map a thrown domain/validation error to an HTTP response. Unknown errors
 * become a generic 500 with a stable envelope (the message is logged server-
 * side but not leaked verbatim in production).
 */
export function handleError(err: unknown): NextResponse {
  if (err instanceof AuthenticationError) return unauthorized();
  if (err instanceof ProjectNotFoundError) return notFound();
  if (err instanceof ValidationError) {
    return badRequest(err.message, err.code);
  }
  if (err instanceof SyntaxError) {
    // Malformed JSON body.
    return badRequest("request body must be valid JSON", "invalid_json");
  }
  // Surface a stable envelope; print the real error for the operator.
  console.error("[api] unhandled error:", err);
  return NextResponse.json(
    errorBody("internal server error", "internal"),
    { status: 500 },
  );
}

/** Parse and validate a JSON request body. Throws SyntaxError on bad JSON. */
export async function parseJson<T = unknown>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length === 0) return {} as T;
  return JSON.parse(text) as T;
}

/**
 * Shared route-handler context shape. Next.js async `params` are a Promise over
 * the dynamic segments. The default covers the common single-segment `:id`;
 * pass a narrower shape for multi-segment routes (e.g. `{ id; blockerId }`).
 */
export interface RouteContext<
  T extends Record<string, string> = { id: string },
> {
  params: Promise<T>;
}

/**
 * Resolve the active project for a request. Reads `?project=KEY` from the URL:
 *   - absent or empty → the default project (first by id) — backward-compatible
 *     with the single-project API every existing agent uses.
 *   - present but doesn't match a project → 404, including when it belongs to
 *     another workspace.
 *
 * Every `/api/issues/*` route passes its Request through this so the scope is
 * applied uniformly. The resolver then gates identifier-form lookups against
 * `project.key` to prevent cross-project leakage.
 */
export function requireProject(db: DB, url: URL): ProjectRow {
  return requireProjectForOwner(db, url, 1);
}

export interface AgentPrincipal { ownerId: number; tokenId: number; }

/** Authenticate a non-interactive agent with its account-scoped bearer token. */
export function requireAgentPrincipal(req: Request, db: DB): AgentPrincipal {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AuthenticationError("authentication required");
  const token = findActiveAgentByToken(db, match[1]);
  if (!token) throw new AuthenticationError("authentication required");
  return { ownerId: token.ownerId, tokenId: token.id };
}

/** A browser user may use the same project creation endpoint as the UI; agents
 * remain bearer-token-only. The workspace always comes from the credential. */
export async function requireWorkspacePrincipal(req: Request, db: DB): Promise<AgentPrincipal> {
  const authorization = req.headers.get("authorization");
  if (authorization?.trim()) return requireAgentPrincipal(req, db);
  const session = await getBrowserSession();
  if (!session) throw new AuthenticationError("authentication required");
  return { ownerId: session.user.ownerId, tokenId: 0 };
}

/** Resolve an API project only within the authenticated agent's workspace. */
export function requireAuthorizedProject(req: Request, db: DB, url: URL): ProjectRow {
  return requireProjectForOwner(db, url, requireAgentPrincipal(req, db).ownerId);
}

export function requireProjectForOwner(db: DB, url: URL, ownerId: number): ProjectRow {
  const key = url.searchParams.get("project");
  if (key === null || key.trim().length === 0) {
    const def = getDefaultProjectForOwner(db, ownerId);
    if (!def) {
      throw new ValidationError("no projects exist", "no_projects");
    }
    return def;
  }
  const found = getProjectByKeyForOwner(db, ownerId, key);
  if (!found) {
    throw new ProjectNotFoundError();
  }
  return found;
}
