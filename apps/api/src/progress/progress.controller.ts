/**
 * Offline-first sync and the weekly report.
 *
 *  - The phone queues AttemptEvents while offline and POSTs them in batches.
 *  - eventId (client UUID) makes sync idempotent: retries never double count.
 *  - Progress is ALWAYS scoped by packId, so packs (grades, subjects, countries)
 *    never collide even if they reuse skill ids.
 *  - Mastery is recomputed from the full event log with the same engine the phone uses.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { computeSkillStates, DEFAULT_RULES, localDay, SYNC_MAX_EVENTS, weeklySummary, type MasteryRules } from "@dunialab/mastery";
import type { AppConfig } from "../config.js";
import { parse } from "../common/zod.js";
import { Parent, ParentAuthGuard, type AuthedParent } from "../auth/auth.guard.js";
import type { ContentRegistry } from "../content/content-registry.js";
import type { Store } from "../store/store.js";
import { CONFIG, CONTENT, STORE } from "../tokens.js";

/** Shared with every client through @dunialab/mastery (findings register R4). */
const MAX_BATCH = SYNC_MAX_EVENTS;

const Event = z
  .object({
    eventId: z.string().uuid(),
    profileId: z.string().uuid(),
    skillId: z.string().min(1).max(100),
    taskId: z.string().min(1).max(100),
    kind: z.enum(["choice", "locate", "explain", "follow-up"]),
    correct: z.boolean(),
    occurredAt: z.string().datetime({ offset: true }),
    context: z.enum(["mission", "review"]),
    checkedBy: z.enum(["ai", "local"]).optional(),
  })
  .strict();

const SyncBody = z
  .object({
    profileId: z.string().uuid(),
    packId: z.string().min(1),
    events: z.array(Event).max(MAX_BATCH),
  })
  .strict();

const ReportQuery = z.object({
  packId: z.string().min(1),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locale: z.enum(["en", "sw"]).default("en"),
});

@Controller("v1")
@UseGuards(ParentAuthGuard)
export class ProgressController {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CONTENT) private readonly content: ContentRegistry,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private get rules(): MasteryRules {
    return { ...DEFAULT_RULES, utcOffsetMinutes: this.config.utcOffsetMinutes };
  }

  private async ownedProfile(parentId: string, profileId: string) {
    const profile = await this.store.getProfile(parentId, profileId);
    // 404 rather than 403: do not reveal that someone else's profile exists.
    if (!profile) throw new NotFoundException("profile not found");
    return profile;
  }

  private pack(packId: string) {
    const loaded = this.content.get(packId);
    if (!loaded) throw new BadRequestException(`unknown content pack "${packId}"`);
    return loaded;
  }

  @Post("sync")
  @HttpCode(200)
  async sync(@Parent() parent: AuthedParent, @Body() body: unknown) {
    const input = parse(SyncBody, body);
    const loaded = this.pack(input.packId);
    await this.ownedProfile(parent.parentId, input.profileId);

    const skillIds = new Set(loaded.skillIds);
    const bad = input.events.filter((e) => e.profileId !== input.profileId || !skillIds.has(e.skillId));
    if (bad.length > 0) {
      throw new BadRequestException({
        message: "batch rejected: events reference another profile or skills not in this pack",
        eventIds: bad.map((e) => e.eventId),
      });
    }

    const accepted = await this.store.insertEvents(input.packId, input.events);
    const all = await this.store.listEvents(input.profileId, input.packId);
    const states = computeSkillStates(all, this.rules, loaded.skillIds);
    return {
      accepted,
      duplicates: input.events.length - accepted,
      skills: Object.values(states),
    };
  }

  @Get("profiles/:id/report")
  async report(@Parent() parent: AuthedParent, @Param("id") profileId: string, @Query() query: unknown) {
    const q = parse(ReportQuery, query);
    if (!z.string().uuid().safeParse(profileId).success) throw new NotFoundException("profile not found");
    const profile = await this.ownedProfile(parent.parentId, profileId);
    const { pack, skillIds } = this.pack(q.packId);

    const week = q.week ?? localDay(new Date().toISOString(), this.config.utcOffsetMinutes);
    const events = await this.store.listEvents(profileId, q.packId);
    const summary = weeklySummary(events, week, skillIds, this.rules);
    const labels = new Map(pack.skills.map((s) => [s.id, s.parentLabel[q.locale]]));

    return {
      profile: { id: profile.id, nickname: profile.nickname },
      pack: { id: pack.id, title: pack.title[q.locale] },
      ...summary,
      lines: summary.lines.map((l) => ({ ...l, label: labels.get(l.skillId) ?? l.skillId })),
    };
  }
}
