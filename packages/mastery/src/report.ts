/**
 * Weekly summary for the parent/teacher report.
 * Reports learning (skills), not screen time. Deliberately no minutes.
 */
import { addDays, localDay } from "./days.js";
import { computeSkillStates, dedupe } from "./engine.js";
import { DEFAULT_RULES, type AttemptEvent, type MasteryRules, type SkillStatus } from "./types.js";

export interface WeeklySkillLine {
  skillId: string;
  status: SkillStatus;
  masteredThisWeek: boolean;
  attemptsThisWeek: number;
  correctThisWeek: number;
  needsSupport: boolean;
}

export interface WeeklySummary {
  fromDay: string;
  toDay: string;
  activeDays: number;
  skillsMasteredThisWeek: number;
  skillsMasteredTotal: number;
  lines: WeeklySkillLine[];
}

/** Needs support = practised this week, not mastered, and under half correct. */
const NEEDS_SUPPORT_RATIO = 0.5;

export function weeklySummary(
  events: readonly AttemptEvent[],
  toDay: string,
  skillIds: readonly string[],
  rules: MasteryRules = DEFAULT_RULES,
): WeeklySummary {
  const fromDay = addDays(toDay, -6);
  // The same event can arrive twice (a retried sync); count it once, as the state replay does
  // (findings register CR28).
  const upTo = dedupe(events).filter((e) => localDay(e.occurredAt, rules.utcOffsetMinutes) <= toDay);
  const states = computeSkillStates(upTo, rules, skillIds);
  const inWeek = upTo.filter((e) => localDay(e.occurredAt, rules.utcOffsetMinutes) >= fromDay);

  const days = new Set(inWeek.map((e) => localDay(e.occurredAt, rules.utcOffsetMinutes)));

  const lines: WeeklySkillLine[] = Object.values(states).map((s) => {
    const mine = inWeek.filter((e) => e.skillId === s.skillId);
    const correct = mine.filter((e) => e.correct).length;
    const masteredThisWeek = s.masteredOn !== null && s.masteredOn >= fromDay && s.masteredOn <= toDay;
    return {
      skillId: s.skillId,
      status: s.status,
      masteredThisWeek,
      attemptsThisWeek: mine.length,
      correctThisWeek: correct,
      needsSupport: s.status !== "mastered" && mine.length > 0 && correct / mine.length < NEEDS_SUPPORT_RATIO,
    };
  });

  return {
    fromDay,
    toDay,
    activeDays: days.size,
    skillsMasteredThisWeek: lines.filter((l) => l.masteredThisWeek).length,
    skillsMasteredTotal: lines.filter((l) => l.status === "mastered").length,
    lines,
  };
}
