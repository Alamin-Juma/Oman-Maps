import { Body, Controller, HttpCode, Inject, Logger, NotFoundException, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { checkExplanationLocally, type ExplanationFeedback } from "@dunialab/content";
import type { AppConfig } from "../config.js";
import { parse } from "../common/zod.js";
import { Parent, ParentAuthGuard, type AuthedParent } from "../auth/auth.guard.js";
import type { ContentRegistry } from "../content/content-registry.js";
import type { Store } from "../store/store.js";
import { ATTEMPT_LIMITER, CONFIG, CONTENT, AI_GRADER, STORE } from "../tokens.js";
import type { AttemptLimiter } from "../auth/attempt-limiter.js";

/** Limiter key for the deployment-wide online-check cap. */
const DEPLOYMENT_KEY = "ai:deployment";
import type { AiGrader } from "./ai-grader.js";
import { decideFeedback } from "./decide.js";
import { redactIdentifiers } from "./redact.js";

const CheckBody = z
  .object({
    packId: z.string().min(1),
    taskId: z.string().min(1),
    answer: z.string().max(500),
    locale: z.enum(["en", "sw"]),
    attempt: z.number().int().min(1).max(2).default(1),
  })
  .strict();

/** Settle with `work`, or abort `controller` and reject after `ms`. */
function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      controller.abort(); // stop the provider request: an answer we no longer wait for is not paid for
      reject(new Error(`AI check timed out after ${ms}ms`));
    }, ms);
    work(controller.signal).then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

@Controller("v1/explanations")
@UseGuards(ParentAuthGuard)
export class ExplanationsController {
  private readonly log = new Logger("Explanations");

  /** Online checks running now, per parent (findings register CR7). */
  private readonly running = new Map<string, number>();

  constructor(
    @Inject(CONTENT) private readonly content: ContentRegistry,
    @Inject(AI_GRADER) private readonly grader: AiGrader | null,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(STORE) private readonly store: Store,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
  ) {}

  /**
   * May this parent's check go to the paid provider now? Refusal is not an error: the child gets
   * the offline checker's answer (findings register CR7).
   */
  private admit(parentId: string): boolean {
    const limits = this.config.rateLimits;
    const parentKey = `ai:parent:${parentId}`;
    if ((this.running.get(parentId) ?? 0) >= limits.aiConcurrentPerParent) return false;
    if (this.limiter.retryAfterSeconds(parentKey, limits.aiChecksPerParent) > 0) return false;
    if (this.limiter.retryAfterSeconds(DEPLOYMENT_KEY, limits.aiChecksPerDeployment) > 0) return false;
    this.limiter.record(parentKey, limits.aiChecksPerParent);
    this.limiter.record(DEPLOYMENT_KEY, limits.aiChecksPerDeployment);
    return true;
  }

  @Post("check")
  @HttpCode(200)
  async check(@Parent() parent: AuthedParent, @Body() body: unknown): Promise<ExplanationFeedback> {
    const input = parse(CheckBody, body);
    const ref = this.content.get(input.packId)?.tasks.get(input.taskId);
    if (!ref || ref.task.type !== "explain") throw new NotFoundException("explanation task not found");
    const task = ref.task;

    const local = () => checkExplanationLocally(task, input.answer, input.locale, input.attempt);
    const grader = this.grader;
    if (!grader || input.answer.trim().length === 0) return local();

    let admitted = false;
    try {
      // Egress gate: a child's words only go to an external provider after the parent has
      // consented to the current policy. A failing lookup is answered locally too (findings
      // register CR17): the offline checker needs neither the database nor the AI.
      if (!(await this.store.hasConsent(parent.parentId, this.config.consentPolicyVersion))) return local();
      if (!this.admit(parent.parentId)) {
        this.log.warn("online check allowance reached; using the local rubric");
        return local();
      }
      admitted = true;
      this.running.set(parent.parentId, (this.running.get(parent.parentId) ?? 0) + 1);
      const grade = await withTimeout(
        (signal) => grader.grade({ task, locale: input.locale, answer: redactIdentifiers(input.answer) }, { signal }),
        this.config.aiTimeoutMs,
      );
      return decideFeedback(task, grade, input.attempt, this.config.aiConfidenceThreshold);
    } catch (err) {
      // Never block a child on the network or the model: fall back to the offline checker.
      this.log.warn(`AI check failed, using local rubric: ${(err as Error).message}`);
      return local();
    } finally {
      if (admitted) {
        const left = (this.running.get(parent.parentId) ?? 1) - 1;
        if (left > 0) this.running.set(parent.parentId, left);
        else this.running.delete(parent.parentId);
      }
    }
  }
}
