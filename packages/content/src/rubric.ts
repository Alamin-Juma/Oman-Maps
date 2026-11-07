/**
 * Offline rubric checker.
 *
 * Runs on the phone with no network. It is intentionally simple and
 * deterministic: phrase evidence per criterion, written by the teacher.
 * It is the fallback when the AI service is unreachable, and the baseline the
 * AI must beat on the teacher-marked test set (target: >= 85% agreement).
 */
import type { ExplainTask, Hint, Locale } from "./schema.js";
import type { ExplanationFeedback } from "./feedback.js";

/** Confidence the local checker reports. Below the AI threshold on purpose. */
export const LOCAL_CHECK_CONFIDENCE = 0.6;

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function contains(haystack: string, phrase: string): boolean {
  const needle = normalise(phrase).trim();
  if (!needle) return false;
  // Prefix match on word boundary: "cool" matches "cooler", "colder" needs its own entry.
  return haystack.includes(` ${needle}`);
}

export function criteriaMetLocally(task: ExplainTask, answer: string, locale: Locale): string[] {
  const text = normalise(answer);
  return task.rubric.criteria
    .filter((c) => {
      // Children code-switch between English and Kiswahili, so check both.
      const phrases = [...c.evidence[locale], ...c.evidence[locale === "en" ? "sw" : "en"]];
      return phrases.some((p) => contains(text, p));
    })
    .map((c) => c.id);
}

/** First hint that targets a criterion the child has not met yet. */
export function pickHint(task: ExplainTask, criteriaMet: readonly string[]): Hint | undefined {
  return task.hints.find((h) => !criteriaMet.includes(h.criterionId)) ?? task.hints[0];
}

export const MIN_ANSWER_CHARS = 8;

/**
 * @param attempt 1-based attempt number. A child gets at most one hint;
 *                on the second miss we fall back to the multiple-choice follow-up.
 */
export function checkExplanationLocally(
  task: ExplainTask,
  answer: string,
  locale: Locale,
  attempt = 1,
): ExplanationFeedback {
  const base = { confidence: LOCAL_CHECK_CONFIDENCE, checkedBy: "local" as const, flagForTeacher: false };

  if (normalise(answer).trim().length < MIN_ANSWER_CHARS) {
    return { ...base, outcome: "choice-follow-up", hintId: null, criteriaMet: [] };
  }

  const met = criteriaMetLocally(task, answer, locale);
  if (met.length >= task.rubric.minCriteria) {
    return { ...base, outcome: "accepted", hintId: null, criteriaMet: met };
  }
  if (attempt >= 2) {
    return { ...base, outcome: "choice-follow-up", hintId: null, criteriaMet: met };
  }
  return { ...base, outcome: "hint", hintId: pickHint(task, met)?.id ?? null, criteriaMet: met };
}
