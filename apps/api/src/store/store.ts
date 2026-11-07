/**
 * Persistence port. Controllers depend on this interface only, so the
 * in-memory adapter (tests, demos) and the Postgres adapter are swappable.
 */
import type { AttemptEvent } from "@dunialab/mastery";

export interface Parent {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Consent {
  id: string;
  parentId: string;
  policyVersion: string;
  method: string;
  givenAt: Date;
}

export interface ChildProfile {
  id: string;
  parentId: string;
  nickname: string;
  grade: number;
  pinHash: string;
  createdAt: Date;
}

export class EmailTakenError extends Error {
  constructor() {
    super("email already registered");
  }
}

export interface Store {
  readonly kind: "memory" | "postgres";
  createParent(email: string, passwordHash: string): Promise<Parent>;
  findParentByEmail(email: string): Promise<Parent | null>;
  addConsent(parentId: string, policyVersion: string, method: string): Promise<Consent>;
  hasConsent(parentId: string, policyVersion: string): Promise<boolean>;
  createProfile(parentId: string, p: { nickname: string; grade: number; pinHash: string }): Promise<ChildProfile>;
  listProfiles(parentId: string): Promise<ChildProfile[]>;
  /** Returns null when the profile does not exist OR belongs to another parent. */
  getProfile(parentId: string, profileId: string): Promise<ChildProfile | null>;
  /** Idempotent by eventId. Returns how many were newly inserted. */
  insertEvents(packId: string, events: AttemptEvent[]): Promise<number>;
  listEvents(profileId: string, packId: string): Promise<AttemptEvent[]>;
  close(): Promise<void>;
}
