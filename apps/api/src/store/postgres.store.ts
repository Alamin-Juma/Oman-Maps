import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AttemptEvent } from "@dunialab/mastery";
import * as schema from "../db/schema.js";
import { EmailTakenError, type ChildProfile, type Store } from "./store.js";

const UNIQUE_VIOLATION = "23505";

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    this.db = drizzle(this.pool, { schema });
  }

  async createParent(email: string, passwordHash: string) {
    try {
      const [row] = await this.db.insert(schema.parents).values({ email, passwordHash }).returning();
      return row!;
    } catch (err) {
      if ((err as { code?: string; cause?: { code?: string } }).code === UNIQUE_VIOLATION ||
          (err as { cause?: { code?: string } }).cause?.code === UNIQUE_VIOLATION) {
        throw new EmailTakenError();
      }
      throw err;
    }
  }

  async findParentByEmail(email: string) {
    const [row] = await this.db.select().from(schema.parents).where(eq(schema.parents.email, email)).limit(1);
    return row ?? null;
  }

  async addConsent(parentId: string, policyVersion: string, method: string) {
    const [row] = await this.db.insert(schema.consents).values({ parentId, policyVersion, method }).returning();
    return row!;
  }

  async hasConsent(parentId: string, policyVersion: string) {
    const rows = await this.db
      .select({ id: schema.consents.id })
      .from(schema.consents)
      .where(and(eq(schema.consents.parentId, parentId), eq(schema.consents.policyVersion, policyVersion)))
      .limit(1);
    return rows.length > 0;
  }

  async createProfile(parentId: string, p: { nickname: string; grade: number; pinHash: string }) {
    const [row] = await this.db.insert(schema.childProfiles).values({ parentId, ...p }).returning();
    return row!;
  }

  async listProfiles(parentId: string): Promise<ChildProfile[]> {
    return this.db.select().from(schema.childProfiles).where(eq(schema.childProfiles.parentId, parentId));
  }

  async getProfile(parentId: string, profileId: string) {
    const [row] = await this.db
      .select()
      .from(schema.childProfiles)
      .where(and(eq(schema.childProfiles.id, profileId), eq(schema.childProfiles.parentId, parentId)))
      .limit(1);
    return row ?? null;
  }

  async insertEvents(packId: string, events: AttemptEvent[]) {
    if (events.length === 0) return 0;
    const rows = await this.db
      .insert(schema.learningEvents)
      .values(
        events.map((e) => ({
          eventId: e.eventId,
          profileId: e.profileId,
          packId,
          skillId: e.skillId,
          taskId: e.taskId,
          kind: e.kind,
          correct: e.correct,
          occurredAt: new Date(e.occurredAt),
          context: e.context,
          checkedBy: e.checkedBy ?? null,
        })),
      )
      .onConflictDoNothing({ target: schema.learningEvents.eventId })
      .returning({ id: schema.learningEvents.eventId });
    return rows.length;
  }

  async listEvents(profileId: string, packId: string): Promise<AttemptEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.learningEvents)
      .where(and(eq(schema.learningEvents.profileId, profileId), eq(schema.learningEvents.packId, packId)));
    return rows.map((r) => ({
      eventId: r.eventId,
      profileId: r.profileId,
      skillId: r.skillId,
      taskId: r.taskId,
      kind: r.kind as AttemptEvent["kind"],
      correct: r.correct,
      occurredAt: r.occurredAt.toISOString(),
      context: r.context as AttemptEvent["context"],
      ...(r.checkedBy ? { checkedBy: r.checkedBy as "ai" | "local" } : {}),
    }));
  }

  async close() {
    await this.pool.end();
  }
}
