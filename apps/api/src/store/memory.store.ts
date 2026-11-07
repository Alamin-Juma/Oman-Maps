import { randomUUID } from "node:crypto";
import type { AttemptEvent } from "@dunialab/mastery";
import { EmailTakenError, type ChildProfile, type Consent, type Parent, type Store } from "./store.js";

/** In-memory adapter for tests and local demos. Not for production. */
export class InMemoryStore implements Store {
  readonly kind = "memory" as const;
  private parents = new Map<string, Parent>();
  private consents: Consent[] = [];
  private profiles = new Map<string, ChildProfile>();
  private events = new Map<string, AttemptEvent & { packId: string }>();

  async createParent(email: string, passwordHash: string): Promise<Parent> {
    if (await this.findParentByEmail(email)) throw new EmailTakenError();
    const p: Parent = { id: randomUUID(), email, passwordHash, createdAt: new Date() };
    this.parents.set(p.id, p);
    return p;
  }

  async findParentByEmail(email: string) {
    return [...this.parents.values()].find((p) => p.email === email) ?? null;
  }

  async addConsent(parentId: string, policyVersion: string, method: string): Promise<Consent> {
    const c: Consent = { id: randomUUID(), parentId, policyVersion, method, givenAt: new Date() };
    this.consents.push(c);
    return c;
  }

  async hasConsent(parentId: string, policyVersion: string) {
    return this.consents.some((c) => c.parentId === parentId && c.policyVersion === policyVersion);
  }

  async createProfile(parentId: string, p: { nickname: string; grade: number; pinHash: string }) {
    const profile: ChildProfile = { id: randomUUID(), parentId, ...p, createdAt: new Date() };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async listProfiles(parentId: string) {
    return [...this.profiles.values()].filter((p) => p.parentId === parentId);
  }

  async getProfile(parentId: string, profileId: string) {
    const p = this.profiles.get(profileId);
    return p && p.parentId === parentId ? p : null;
  }

  async insertEvents(packId: string, events: AttemptEvent[]) {
    let inserted = 0;
    for (const e of events) {
      if (this.events.has(e.eventId)) continue;
      this.events.set(e.eventId, { ...e, packId });
      inserted++;
    }
    return inserted;
  }

  async listEvents(profileId: string, packId: string) {
    return [...this.events.values()]
      .filter((e) => e.profileId === profileId && e.packId === packId)
      .map(({ packId: _p, ...e }) => e);
  }

  async close() {}
}
