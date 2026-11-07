/**
 * Turn an AI grade into feedback a child may see. Pure function; this is where
 * the product's AI guardrails live:
 *   1. unsafe            -> multiple-choice follow-up + teacher flag
 *   2. low confidence    -> multiple-choice follow-up   ("below the threshold ...")
 *   3. off-topic         -> multiple-choice follow-up
 *   4. meets AND enough known criteria -> accepted
 *   5. otherwise         -> one approved hint (first attempt) or follow-up (second)
 * The model may only reference criteria and hints that exist in the task;
 * anything else is discarded.
 */
import { pickHint, type ExplainTask, type ExplanationFeedback } from "@dunialab/content";
import type { AiGrade } from "./ai-grader.js";

export function decideFeedback(
  task: ExplainTask,
  grade: AiGrade,
  attempt: number,
  threshold: number,
): ExplanationFeedback {
  const knownCriteria = new Set(task.rubric.criteria.map((c) => c.id));
  const criteriaMet = [...new Set(grade.criteriaMet.filter((c) => knownCriteria.has(c)))];
  const confidence = Math.min(1, Math.max(0, Number.isFinite(grade.confidence) ? grade.confidence : 0));
  const base = { criteriaMet, confidence, checkedBy: "ai" as const };

  if (grade.unsafe) return { ...base, outcome: "choice-follow-up", hintId: null, flagForTeacher: true };
  if (confidence < threshold || grade.verdict === "off-topic") {
    return { ...base, outcome: "choice-follow-up", hintId: null, flagForTeacher: false };
  }
  if (grade.verdict === "meets" && criteriaMet.length >= task.rubric.minCriteria) {
    return { ...base, outcome: "accepted", hintId: null, flagForTeacher: false };
  }
  if (attempt >= 2) return { ...base, outcome: "choice-follow-up", hintId: null, flagForTeacher: false };

  const proposed = task.hints.find((h) => h.id === grade.hintId && !criteriaMet.includes(h.criterionId));
  const hint = proposed ?? pickHint(task, criteriaMet);
  return { ...base, outcome: "hint", hintId: hint?.id ?? null, flagForTeacher: false };
}
