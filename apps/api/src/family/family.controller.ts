/**
 * Consent and child profiles.
 * Rule: no child profile can exist before the parent consents to the CURRENT
 * policy version (ODPC children's-data guidance; Data Protection Act 2019).
 */
import { Body, Controller, ForbiddenException, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { parse } from "../common/zod.js";
import { hashSecret } from "../auth/password.js";
import { Parent, ParentAuthGuard, type AuthedParent } from "../auth/auth.guard.js";
import type { ChildProfile, Store } from "../store/store.js";
import { CONFIG, STORE } from "../tokens.js";

const ConsentBody = z.object({ policyVersion: z.string().min(1), accepted: z.literal(true) }).strict();

/** Picture PIN: 3 picture ids chosen by the child. Never the child's personal details. */
const PICTURES = ["lion", "elephant", "giraffe", "zebra", "mango", "banana", "drum", "ball", "sun", "moon", "fish", "boat"] as const;

const ProfileBody = z
  .object({
    nickname: z.string().trim().min(1).max(24),
    grade: z.number().int().min(1).max(12),
    picturePin: z.array(z.enum(PICTURES)).length(3),
  })
  .strict(); // strict: unknown fields (dateOfBirth, photoUrl, ...) are rejected, not ignored

export function publicProfile(p: ChildProfile) {
  return { id: p.id, nickname: p.nickname, grade: p.grade, createdAt: p.createdAt.toISOString() };
}

@Controller("v1")
@UseGuards(ParentAuthGuard)
export class FamilyController {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("consents")
  async consent(@Parent() parent: AuthedParent, @Body() body: unknown) {
    const { policyVersion } = parse(ConsentBody, body);
    if (policyVersion !== this.config.consentPolicyVersion) {
      throw new ForbiddenException(`consent must be for the current policy (${this.config.consentPolicyVersion})`);
    }
    const c = await this.store.addConsent(parent.parentId, policyVersion, "in-app-explicit");
    return { id: c.id, policyVersion: c.policyVersion, givenAt: c.givenAt.toISOString() };
  }

  @Post("profiles")
  async createProfile(@Parent() parent: AuthedParent, @Body() body: unknown) {
    const input = parse(ProfileBody, body);
    if (!(await this.store.hasConsent(parent.parentId, this.config.consentPolicyVersion))) {
      throw new ForbiddenException("parental consent is required before creating a child profile");
    }
    const profile = await this.store.createProfile(parent.parentId, {
      nickname: input.nickname,
      grade: input.grade,
      pinHash: await hashSecret(input.picturePin.join("|")),
    });
    return publicProfile(profile);
  }

  @Get("profiles")
  async listProfiles(@Parent() parent: AuthedParent) {
    return (await this.store.listProfiles(parent.parentId)).map(publicProfile);
  }
}
