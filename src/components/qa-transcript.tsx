import { renderMarkdown } from "@/lib/markdown";
import type { QuestionDTO } from "@/lib/types";
import {
  CheckCircle2,
  CornerDownRight,
  MessageCircleQuestion,
} from "lucide-react";

/**
 * Read-only Q&A transcript — the human's window into the agent conversation
 * happening on a ticket. An implementing agent posts questions and an
 * orchestrating model answers them; the UI only *displays* this exchange
 * (asking/answering are API-only). It is observed, never participated in.
 *
 * The tracker is meant to be fun to watch, so this is first-class:
 *  - an open Question reads as visibly pending (the agent is blocked, waiting)
 *  - an answered Question reads as resolved (green check, the answer shown)
 *
 * Server component: markdown is rendered server-side via renderMarkdown, the
 * same path used for issue descriptions.
 */
export async function QATranscript({
  questions,
}: {
  questions: QuestionDTO[];
}) {
  if (questions.length === 0) return null;
  const openCount = questions.filter((q) => q.status === "open").length;

  // Pre-render all question + answer markdown server-side.
  const rendered = await Promise.all(
    questions.map(async (q) => ({
      q,
      questionHtml: await renderMarkdown(q.question),
      answerHtml: q.answer === null ? "" : await renderMarkdown(q.answer),
    })),
  );

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium text-[--foreground-muted] uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <MessageCircleQuestion size={13} />
        Agent Q&amp;A
        {openCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 normal-case tracking-normal">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            {openCount} awaiting answer
          </span>
        )}
      </h2>

      <ul className="space-y-2">
        {rendered.map(({ q, questionHtml, answerHtml }) => (
          <QuestionCard
            key={q.id}
            question={q}
            questionHtml={questionHtml}
            answerHtml={answerHtml}
          />
        ))}
      </ul>
    </section>
  );
}

function QuestionCard({
  question,
  questionHtml,
  answerHtml,
}: {
  question: QuestionDTO;
  questionHtml: string;
  answerHtml: string;
}) {
  const isOpen = question.status === "open";

  return (
    <li
      className={
        "rounded-lg border bg-[--surface] p-3 transition-colors " +
        (isOpen
          ? "border-amber-500/40 bg-amber-500/[0.04]"
          : "border-[--border]")
      }
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-mono text-[11px] text-[--foreground-subtle]">
          Q{question.number}
        </span>
        {isOpen ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            awaiting answer
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            <CheckCircle2 size={11} />
            answered
          </span>
        )}
        <time
          className="ml-auto text-[10px] text-[--foreground-subtle]"
          dateTime={question.createdAt}
        >
          {new Date(question.createdAt).toLocaleString()}
        </time>
      </div>

      <div
        className="prose-tight text-sm text-[--foreground] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: questionHtml }}
      />

      {!isOpen && question.answer !== null && (
        <div className="mt-3 flex gap-2 border-t border-[--border] pt-3">
          <CornerDownRight
            size={14}
            className="mt-0.5 shrink-0 text-emerald-400"
          />
          <div className="flex-1">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[--foreground-subtle]">
              Answer
            </div>
            <div
              className="prose-tight text-sm text-[--foreground] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: answerHtml }}
            />
            {question.answeredAt && (
              <time
                className="mt-1.5 block text-[10px] text-[--foreground-subtle]"
                dateTime={question.answeredAt}
              >
                {new Date(question.answeredAt).toLocaleString()}
              </time>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
