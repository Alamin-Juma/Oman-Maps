/**
 * Mastery engine.
 *
 * State is DERIVED from the event log (event sourcing): replaying the same
 * events with the same rules always yields the same state, on the phone and
 * on the server. Never store mastery as a mutable flag.
 *
 * Rules (product definition, "Engineering decisions"):
 *  - Mastered  = correct on >= 2 separate local days, including >= 1 accepted
 *                explanation. Mastery is sticky (never taken away from a child).
 *  - Review    = Leitner boxes. A correct review promotes one box (at most once
 *                per day); a wrong review drops to box 0. Next review is
 *                lastActivityDay + interval[box].
 *  - The AI result is just one input: it can only produce an "explain" event
 *    with correct=true/false. Whether that makes a skill mastered is decided here.
 */
import { addDays, localDay } from "./days.js";
import { DEFAULT_RULES, type AttemptEvent, type MasteryRules, type SkillState } from "./types.js";

export function emptySkillState(skillId: string): SkillState {
  return {
    skillId,
    status: "not-started",
    attempts: 0,
    correct: 0,
    correctDays: [],
    hasCorrectExplanation: false,
    masteredOn: null,
    box: 0,
    lastActivityDay: null,
    nextReviewDay: null,
  };
}

/** Ordinal (code-unit) string comparison: identical in every language and locale. */
export const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Deterministic order: by instant, then eventId (ordinal) as a tiebreak. */
export function sortEvents(events: readonly AttemptEvent[]): AttemptEvent[] {
  return [...events].sort((a, b) => {
    const dt = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    return dt !== 0 ? dt : ordinal(a.eventId, b.eventId);
  });
}

/** De-duplicate by eventId (sync may deliver the same event twice). */
export function dedupe(events: readonly AttemptEvent[]): AttemptEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.eventId) ? false : (seen.add(e.eventId), true)));
}

interface Scratch {
  lastPromotionDay: string | null;
}

function apply(state: SkillState, scratch: Scratch, e: AttemptEvent, rules: MasteryRules): void {
  const day = localDay(e.occurredAt, rules.utcOffsetMinutes);
  const maxBox = rules.reviewIntervalsDays.length - 1;

  state.attempts += 1;
  if (e.correct) {
    state.correct += 1;
    if (!state.correctDays.includes(day)) {
      state.correctDays.push(day);
      state.correctDays.sort();
    }
    if (e.kind === "explain") state.hasCorrectExplanation = true;
  }

  if (e.context === "review") {
    if (e.correct) {
      if (scratch.lastPromotionDay !== day) {
        state.box = Math.min(state.box + 1, maxBox);
        scratch.lastPromotionDay = day;
      }
    } else {
      state.box = 0;
    }
  }

  state.lastActivityDay = day;
  state.nextReviewDay = addDays(day, rules.reviewIntervalsDays[state.box]!);

  const mastered =
    state.correctDays.length >= rules.masteryDistinctDays &&
    (!rules.requireExplanation || state.hasCorrectExplanation);

  if (state.status !== "mastered") {
    state.status = mastered ? "mastered" : "practising";
    if (mastered) state.masteredOn = day;
  }
}

/** Replay events into per-skill state. Unknown skills are created on first sight. */
export function computeSkillStates(
  events: readonly AttemptEvent[],
  rules: MasteryRules = DEFAULT_RULES,
  skillIds: readonly string[] = [],
): Record<string, SkillState> {
  // Maps, not plain objects: a skill id is any string, including "constructor" or "__proto__",
  // which a plain object already "has" (findings register CR29).
  const states = new Map<string, SkillState>();
  const scratch = new Map<string, Scratch>();
  for (const id of skillIds) states.set(id, emptySkillState(id));

  for (const e of sortEvents(dedupe(events))) {
    let s = states.get(e.skillId);
    if (!s) states.set(e.skillId, (s = emptySkillState(e.skillId)));
    let sc = scratch.get(e.skillId);
    if (!sc) scratch.set(e.skillId, (sc = { lastPromotionDay: null }));
    apply(s, sc, e, rules);
  }
  // Object.fromEntries defines own properties, so "__proto__" is an ordinary key here.
  return Object.fromEntries(states);
}
