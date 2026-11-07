/**
 * The ONLY feedback a child can ever receive for an explanation.
 *
 * Whether the check ran on-device (offline) or through the AI service, it ends
 * as one of these three outcomes. There is no free-text path from a model to a
 * child: hints are chosen by id from the teacher-approved list.
 */
import { z } from "zod";

export const FeedbackOutcome = z.enum([
  /** Meets the rubric. Counts as a correct explanation for mastery. */
  "accepted",
  /** Show one teacher-written hint and let the child try again. */
  "hint",
  /** Checker unsure (or answer unusable): ask the multiple-choice follow-up. */
  "choice-follow-up",
]);
export type FeedbackOutcome = z.infer<typeof FeedbackOutcome>;

export const CheckedBy = z.enum(["ai", "local"]);
export type CheckedBy = z.infer<typeof CheckedBy>;

export const ExplanationFeedback = z.object({
  outcome: FeedbackOutcome,
  hintId: z.string().nullable(),
  criteriaMet: z.array(z.string()),
  /** 0..1. The local checker reports a fixed, deliberately modest value. */
  confidence: z.number().min(0).max(1),
  checkedBy: CheckedBy,
  /** Set when the answer should be looked at by a teacher (e.g. unsafe content). */
  flagForTeacher: z.boolean(),
});
export type ExplanationFeedback = z.infer<typeof ExplanationFeedback>;
