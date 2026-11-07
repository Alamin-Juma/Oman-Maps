/**
 * AI grading port. The model's raw opinion. It NEVER reaches a child directly:
 * `decideFeedback` turns it into one of the fixed outcomes.
 */
import { z } from "zod";
import type { ExplainTask, Locale } from "@dunialab/content";

export const AiGradeSchema = z.object({
  verdict: z.enum(["meets", "partial", "does-not-meet", "off-topic"]),
  criteriaMet: z.array(z.string()),
  hintId: z.string().nullable(),
  confidence: z.number(),
  unsafe: z.boolean(),
});
export type AiGrade = z.infer<typeof AiGradeSchema>;

/**
 * Input is deliberately minimal: the task (prompt, rubric, approved hints,
 * exemplar), the locale and the child's answer. No profile id, nickname,
 * school or anything else that could identify a child.
 */
export interface AiGradeInput {
  task: ExplainTask;
  locale: Locale;
  answer: string;
}

export interface AiGrader {
  grade(input: AiGradeInput): Promise<AiGrade>;
}
