/**
 * Database schema. Data minimisation is a design rule: there is deliberately
 * no column for a child's real name, date of birth, photo, location or voice.
 * Adding one requires a DPIA update and an ADR.
 */
import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const parents = pgTable("parents", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    policyVersion: text("policy_version").notNull(),
    method: text("method").notNull(),
    givenAt: timestamp("given_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consents_parent_idx").on(t.parentId)],
);

export const childProfiles = pgTable(
  "child_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    grade: integer("grade").notNull(),
    pinHash: text("pin_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("child_profiles_parent_idx").on(t.parentId)],
);

/** Append-only learning event log. Mastery is derived from it, never stored. */
export const learningEvents = pgTable(
  "learning_events",
  {
    /** Client-generated UUID: the idempotency key for offline sync. */
    eventId: uuid("event_id").primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => childProfiles.id, { onDelete: "cascade" }),
    packId: text("pack_id").notNull(),
    skillId: text("skill_id").notNull(),
    taskId: text("task_id").notNull(),
    kind: text("kind").notNull(),
    correct: boolean("correct").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    context: text("context").notNull(),
    checkedBy: text("checked_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("learning_events_profile_pack_idx").on(t.profileId, t.packId, t.occurredAt)],
);
