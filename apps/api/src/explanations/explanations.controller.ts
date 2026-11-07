import { Body, Controller, HttpCode, Inject, Logger, NotFoundException, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { checkExplanationLocally, type ExplanationFeedback } from "@dunialab/content";
import type { AppConfig } from "../config.js";
import { parse } from "../common/zod.js";
import { ParentAuthGuard } from "../auth/auth.guard.js";
import type { ContentRegistry } from "../content/content-registry.js";
import { CONFIG, CONTENT, AI_GRADER } from "../tokens.js";
import type { AiGrader } from "./ai-grader.js";
import { decideFeedback } from "./decide.js";

const CheckBody = z
  .object({
    packId: z.string().min(1),
    taskId: z.string().min(1),
    answer: z.string().max(500),
    locale: z.enum(["en", "sw"]),
    attempt: z.number().int().min(1).max(2).default(1),
  })
  .strict();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`AI check timed out after ${ms}ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

@Controller("v1/explanations")
@UseGuards(ParentAuthGuard)
export class ExplanationsController {
  private readonly log = new Logger("Explanations");

  constructor(
    @Inject(CONTENT) private readonly content: ContentRegistry,
    @Inject(AI_GRADER) private readonly grader: AiGrader | null,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("check")
  @HttpCode(200)
  async check(@Body() body: unknown): Promise<ExplanationFeedback> {
    const input = parse(CheckBody, body);
    const ref = this.content.get(input.packId)?.tasks.get(input.taskId);
    if (!ref || ref.task.type !== "explain") throw new NotFoundException("explanation task not found");
    const task = ref.task;

    const local = () => checkExplanationLocally(task, input.answer, input.locale, input.attempt);
    if (!this.grader || input.answer.trim().length === 0) return local();

    try {
      const grade = await withTimeout(
        this.grader.grade({ task, locale: input.locale, answer: input.answer }),
        this.config.aiTimeoutMs,
      );
      return decideFeedback(task, grade, input.attempt, this.config.aiConfidenceThreshold);
    } catch (err) {
      // Never block a child on the network or the model: fall back to the offline checker.
      this.log.warn(`AI check failed, using local rubric: ${(err as Error).message}`);
      return local();
    }
  }
}
