/**
 * Review queue with interleaving.
 *
 * Due skills are ordered most-overdue first, then interleaved round-robin
 * across topics (sub-strands) so the child does not just repeat the last thing
 * studied. Interleaving improves long-term retention compared with blocked
 * practice, at the cost of feeling harder in the moment. That trade is intended.
 */
import { ordinal } from "./engine.js";
import type { SkillState } from "./types.js";

export interface ReviewItem {
  skillId: string;
  topic: string;
  dueDay: string;
}

export function dueSkills(states: Record<string, SkillState>, today: string): SkillState[] {
  return Object.values(states)
    .filter((s) => s.status !== "not-started" && s.nextReviewDay !== null && s.nextReviewDay <= today)
    .sort((a, b) => ordinal(a.nextReviewDay!, b.nextReviewDay!) || ordinal(a.skillId, b.skillId));
}

/**
 * @param topics skillId -> topic id (e.g. sub-strand). Unknown skills share topic "_".
 * @param limit  max items in one review session (keep sessions short).
 */
export function buildReviewQueue(
  states: Record<string, SkillState>,
  today: string,
  topics: Record<string, string>,
  limit = 5,
): ReviewItem[] {
  const due = dueSkills(states, today);

  // Bucket by topic, keeping overdue order inside each bucket and
  // ordering buckets by their most overdue skill.
  const buckets = new Map<string, SkillState[]>();
  for (const s of due) {
    const t = Object.hasOwn(topics, s.skillId) ? topics[s.skillId]! : "_";
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t)!.push(s);
  }

  const queue: ReviewItem[] = [];
  const lists = [...buckets.entries()];
  while (queue.length < limit && lists.some(([, l]) => l.length > 0)) {
    for (const [topic, list] of lists) {
      const s = list.shift();
      if (s) queue.push({ skillId: s.skillId, topic, dueDay: s.nextReviewDay! });
      if (queue.length >= limit) break;
    }
  }
  return queue;
}
