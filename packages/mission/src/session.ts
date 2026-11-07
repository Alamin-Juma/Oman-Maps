/**
 * Mission session: one child playing one mission.
 *
 * Pure and tier-agnostic. Tier A/B (Unity) and Tier C (web) render it;
 * nothing here knows about screens, cameras or networks. That is what keeps
 * learning results comparable across tiers.
 *
 * Rules encoded here:
 *  - Tasks are played in order, one attempt each (the teacher's explanation is shown on a miss).
 *  - Explanation: at most ONE hint, then the multiple-choice follow-up.
 *  - Exactly one AttemptEvent per task resolution (+1 for a follow-up), queued locally.
 */
import {
  checkExplanationLocally,
  type ChoiceTask,
  type ContentPack,
  type ExplainTask,
  type ExplanationFeedback,
  type Hint,
  type LocalizedText,
  type Locale,
  type Mission,
  type Task,
} from "@dunialab/content";
import type { AttemptEvent } from "@dunialab/mastery";

export type Phase = "task" | "hint" | "follow-up" | "done";

export type ExplanationChecker = (
  task: ExplainTask,
  answer: string,
  locale: Locale,
  attempt: number,
) => Promise<ExplanationFeedback> | ExplanationFeedback;

export interface SessionOptions {
  pack: ContentPack;
  missionId: string;
  profileId: string;
  context?: AttemptEvent["context"];
  /** ISO-8601 UTC clock. Injected for determinism in tests. */
  now?: () => string;
  /** UUID generator. Injected for determinism in tests. */
  newId?: () => string;
}

export interface SessionState {
  mission: Mission;
  phase: Phase;
  /** 0-based index of the current task. */
  index: number;
  total: number;
  /** The task to render: the mission task, or the explain task's follow-up in "follow-up" phase. */
  task: Task | null;
  /** Set in "hint" phase. */
  hint: Hint | null;
}

export interface StepResult {
  correct: boolean;
  /** Teacher-written explanation to show after the answer. */
  explanation: LocalizedText;
}

export class MissionSession {
  private index = 0;
  private phase: Phase = "task";
  private hint: Hint | null = null;
  private readonly queue: AttemptEvent[] = [];
  readonly mission: Mission;

  constructor(private readonly opts: Required<Omit<SessionOptions, "context">> & { context: AttemptEvent["context"] }) {
    const mission = opts.pack.missions.find((m) => m.id === opts.missionId);
    if (!mission) throw new Error(`mission "${opts.missionId}" not found in pack "${opts.pack.id}"`);
    this.mission = mission;
  }

  state(): SessionState {
    const t = this.mission.tasks[this.index] ?? null;
    return {
      mission: this.mission,
      phase: this.phase,
      index: this.index,
      total: this.mission.tasks.length,
      task: this.phase === "done" ? null : this.phase === "follow-up" && t?.type === "explain" ? t.followUp : t,
      hint: this.hint,
    };
  }

  /** Events recorded so far (copy). Persist these in the device's offline queue. */
  events(): AttemptEvent[] {
    return [...this.queue];
  }

  answerChoice(optionIds: string[]): StepResult {
    const task = this.state().task;
    if (task?.type !== "choice" || (this.phase !== "task" && this.phase !== "follow-up")) {
      throw new Error(`answerChoice is not valid now (phase=${this.phase}, task=${task?.type})`);
    }
    const correct = sameSet(optionIds, task.correctOptionIds);
    this.record(task, this.phase === "follow-up" ? "follow-up" : "choice", correct);
    this.advance();
    return { correct, explanation: task.explanation };
  }

  answerLocate(featureId: string): StepResult {
    const task = this.state().task;
    if (task?.type !== "locate" || this.phase !== "task") {
      throw new Error(`answerLocate is not valid now (phase=${this.phase}, task=${task?.type})`);
    }
    const correct = featureId === task.featureId;
    this.record(task, "locate", correct);
    this.advance();
    return { correct, explanation: task.explanation };
  }

  /**
   * @param checker optional online checker (e.g. the API). Any error falls back to the
   *                on-device rubric checker, so a mission never waits on the network.
   */
  async answerExplain(
    answer: string,
    locale: Locale,
    checker?: ExplanationChecker,
  ): Promise<{ feedback: ExplanationFeedback; hint: Hint | null }> {
    const task = this.state().task;
    if (task?.type !== "explain" || (this.phase !== "task" && this.phase !== "hint")) {
      throw new Error(`answerExplain is not valid now (phase=${this.phase}, task=${task?.type})`);
    }
    const attempt = this.phase === "hint" ? 2 : 1;

    let feedback: ExplanationFeedback;
    try {
      feedback = checker ? await checker(task, answer, locale, attempt) : checkExplanationLocally(task, answer, locale, attempt);
    } catch {
      feedback = checkExplanationLocally(task, answer, locale, attempt);
    }
    // Never more than one hint, whatever a checker says.
    if (feedback.outcome === "hint" && attempt >= 2) feedback = { ...feedback, outcome: "choice-follow-up", hintId: null };

    if (feedback.outcome === "accepted") {
      this.record(task, "explain", true, feedback.checkedBy);
      this.hint = null;
      this.advance();
    } else if (feedback.outcome === "hint") {
      this.hint = task.hints.find((h) => h.id === feedback.hintId) ?? task.hints[0] ?? null;
      this.phase = "hint";
    } else {
      this.record(task, "explain", false, feedback.checkedBy);
      this.hint = null;
      this.phase = "follow-up";
    }
    return { feedback, hint: this.hint };
  }

  private record(task: Task | ChoiceTask, kind: AttemptEvent["kind"], correct: boolean, checkedBy?: "ai" | "local") {
    this.queue.push({
      eventId: this.opts.newId(),
      profileId: this.opts.profileId,
      skillId: task.skillId,
      taskId: task.id,
      kind,
      correct,
      occurredAt: this.opts.now(),
      context: this.opts.context,
      ...(checkedBy ? { checkedBy } : {}),
    });
  }

  private advance() {
    this.index += 1;
    this.phase = this.index >= this.mission.tasks.length ? "done" : "task";
  }
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  return sa.size === new Set(b).size && b.every((x) => sa.has(x));
}

/**
 * RFC 4122 v4 UUID. `crypto.randomUUID` exists only in secure contexts (HTTPS/localhost);
 * a phone opening the dev server by LAN IP over plain HTTP lacks it, so fall back to
 * `crypto.getRandomValues`, which is available everywhere and equally secure.
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createMissionSession(opts: SessionOptions): MissionSession {
  return new MissionSession({
    context: "mission",
    now: () => new Date().toISOString(),
    newId: uuid,
    ...opts,
  });
}
