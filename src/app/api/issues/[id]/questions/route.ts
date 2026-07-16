import { getDb } from "@/lib/db";
import { addQuestion, getIssueQuestions } from "@/lib/domain";
import {
  conflict,
  handleError,
  notFound,
  ok,
  parseJson,
  RouteContext,
} from "@/lib/api";
import { requireQuestionText } from "@/lib/validate";
import type { CreateQuestionInput } from "@/lib/types";

/**
 * GET /api/issues/:id/questions — the issue's Q&A history, oldest first.
 * (This is also embedded in `GET /api/issues/:id` as `questions[]`.)
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const db = getDb();
    const { id } = await ctx.params;
    const questions = getIssueQuestions(db, id);
    if (questions === null) return notFound("issue not found");
    return ok(questions);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/issues/:id/questions  { question }
 * Post a question against an in_progress issue. The number is assigned
 * atomically as the next per-issue sequence value.
 *   - in_progress → 201 with the created question
 *   - any other status → 409 not_in_progress
 *   - missing issue → 404
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const db = getDb();
    const { id } = await ctx.params;
    const body = await parseJson<CreateQuestionInput>(req);
    const question = requireQuestionText(body.question);

    const result = addQuestion(db, id, question);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound("issue not found");
      return conflict(
        `can only ask questions on an in_progress issue (is "${result.status}")`,
        "not_in_progress",
      );
    }
    return ok(result.question, 201);
  } catch (err) {
    return handleError(err);
  }
}
