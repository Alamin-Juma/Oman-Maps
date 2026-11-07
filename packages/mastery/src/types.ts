/** A single learning event recorded on the device (offline-first) and synced later. */
export interface AttemptEvent {
  /** Client-generated UUID. Makes sync idempotent. */
  eventId: string;
  profileId: string;
  skillId: string;
  taskId: string;
  kind: "choice" | "locate" | "explain" | "follow-up";
  correct: boolean;
  /** ISO-8601 UTC timestamp from the device clock. */
  occurredAt: string;
  context: "mission" | "review";
  /** Only for kind === "explain". */
  checkedBy?: "ai" | "local";
}

export interface MasteryRules {
  /** Correct on at least this many separate local days. */
  masteryDistinctDays: number;
  /** One of the correct attempts must be an accepted explanation. */
  requireExplanation: boolean;
  /** Learner's local UTC offset for day boundaries. Kenya (EAT) = +180, no DST. */
  utcOffsetMinutes: number;
  /** Leitner-style review intervals in days, indexed by box. */
  reviewIntervalsDays: number[];
}

export const DEFAULT_RULES: MasteryRules = {
  masteryDistinctDays: 2,
  requireExplanation: true,
  utcOffsetMinutes: 180,
  reviewIntervalsDays: [1, 3, 7, 14, 30],
};

export type SkillStatus = "not-started" | "practising" | "mastered";

export interface SkillState {
  skillId: string;
  status: SkillStatus;
  attempts: number;
  correct: number;
  /** Sorted distinct local days (YYYY-MM-DD) with at least one correct attempt. */
  correctDays: string[];
  hasCorrectExplanation: boolean;
  /** Local day mastery was first reached. Mastery is never taken away. */
  masteredOn: string | null;
  /** Review box (index into reviewIntervalsDays). */
  box: number;
  lastActivityDay: string | null;
  nextReviewDay: string | null;
}
