import { getDb } from "@/lib/db";
import { respondToQuestion } from "@/lib/domain";
import {
  conflict,
  handleError,
  notFound,
  ok,
  parseJson,
  RouteContext,
} from "@/lib/api";
import { requireAnswerText } from "@/lib/validate";
import type { RespondToQuestionInput } from "@/lib/types";

type Context = RouteContext<{ id: string; number: string }>;

/**
 * POST /api/issues/:id/questions/:number/respond  { answer }
 * Answer a question by its per-issue number. Answering is a single, irreversible
 * event — a second respond against an already-answered question is a 409, not an
 * overwrite. A correction is a new question.
 *   - open question → 200 with the answered question
 *   - already answered → 409 already_answered
 *   - missing issue or question number → 404
 */
export async function POST(req: Request, ctx: Context) {
  try {
    const db = getDb();
    const { id, number: numberParam } = await ctx.params;
    const number = Number(numberParam);
    if (!Number.isInteger(number) || number < 1) {
      return notFound("question not found");
    }

    const body = await parseJson<RespondToQuestionInput>(req);
    const answer = requireAnswerText(body.answer);

    const result = respondToQuestion(db, id, number, answer);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound("question not found");
      return conflict(
        "question already answered",
        "already_answered",
      );
    }
    return ok(result.question);
  } catch (err) {
    return handleError(err);
  }
}
