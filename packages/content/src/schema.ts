/**
 * Content-pack schema: the "curriculum engine" from the product definition.
 *
 * A content pack links curriculum sub-strands -> skills -> missions -> tasks.
 * It is plain JSON so every tier (Unity A/B, web C) and the API read the SAME
 * data. Nothing in here is code a child can run; it is data a teacher signs off.
 */
import { z } from "zod";

/** Every child-facing string ships in English and Kiswahili. */
export const LocalizedText = z.object({
  en: z.string().min(1),
  sw: z.string().min(1),
});
export type LocalizedText = z.infer<typeof LocalizedText>;
export const Locale = z.enum(["en", "sw"]);
export type Locale = z.infer<typeof Locale>;

const Id = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "ids are lowercase kebab/dot case");

/** [longitude, latitude] in WGS84 degrees. */
const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const FeatureKind = z.enum([
  "mountain",
  "lake",
  "river",
  "valley",
  "ocean",
  "coast",
  "plateau",
  "desert",
  "city",
  "map-element",
]);

export const Feature = z.object({
  id: Id,
  kind: FeatureKind,
  name: LocalizedText,
  /** Point used for the tap target / AR anchor. */
  anchor: LonLat,
  /** Optional polyline (rivers, the Rift Valley) for 2D rendering. */
  path: z.array(LonLat).min(2).optional(),
  facts: z.array(LocalizedText).default([]),
  /** Key of a pre-recorded narration clip, resolved per locale by the client. */
  narrationKey: z.string().optional(),
});
export type Feature = z.infer<typeof Feature>;

export const SubStrand = z.object({
  id: Id,
  code: z.string(),
  title: LocalizedText,
  suggestedLessons: z.number().int().positive(),
  inMvp: z.boolean(),
});

export const Skill = z.object({
  id: Id,
  subStrandId: Id,
  /** The curriculum learning outcome this skill evidences (teacher-facing, English). */
  outcome: z.string().min(1),
  /** Parent-facing, plain language. */
  parentLabel: LocalizedText,
});
export type Skill = z.infer<typeof Skill>;

const ChoiceOption = z.object({ id: Id, text: LocalizedText });

export const ChoiceTask = z.object({
  type: z.literal("choice"),
  id: Id,
  skillId: Id,
  prompt: LocalizedText,
  options: z.array(ChoiceOption).min(2).max(6),
  correctOptionIds: z.array(Id).min(1),
  /** Shown after a wrong answer. Teacher-written, never generated. */
  explanation: LocalizedText,
});
export type ChoiceTask = z.infer<typeof ChoiceTask>;

export const LocateTask = z.object({
  type: z.literal("locate"),
  id: Id,
  skillId: Id,
  prompt: LocalizedText,
  featureId: Id,
  explanation: LocalizedText,
});
export type LocateTask = z.infer<typeof LocateTask>;

/**
 * A rubric criterion. `evidence` is used by the OFFLINE checker: each inner
 * array is a group of alternatives; the criterion is met when ANY phrase of
 * ANY group appears in the normalised answer. The online AI checker gets the
 * human description instead and is free to recognise paraphrases.
 */
export const RubricCriterion = z.object({
  id: Id,
  description: z.string().min(1),
  evidence: z.object({
    en: z.array(z.string().min(1)).min(1),
    sw: z.array(z.string().min(1)).min(1),
  }),
});
export type RubricCriterion = z.infer<typeof RubricCriterion>;

export const Hint = z.object({
  id: Id,
  /** The criterion this hint nudges the child toward. */
  criterionId: Id,
  text: LocalizedText,
});
export type Hint = z.infer<typeof Hint>;

export const ExplainTask = z.object({
  type: z.literal("explain"),
  id: Id,
  skillId: Id,
  prompt: LocalizedText,
  /** Optional tap-to-build word bank for children who struggle to type. */
  wordBank: z
    .object({ en: z.array(z.string()), sw: z.array(z.string()) })
    .optional(),
  rubric: z.object({
    criteria: z.array(RubricCriterion).min(1),
    /** How many criteria an answer must meet to be accepted. */
    minCriteria: z.number().int().positive(),
  }),
  /** Teacher-approved hints. The AI may only CHOOSE one of these by id. */
  hints: z.array(Hint).min(1),
  /** Exemplar answer shown after the attempt and given to the AI as reference. */
  exemplar: LocalizedText,
  /** Multiple-choice fallback used when the checker is unsure. */
  followUp: ChoiceTask,
});
export type ExplainTask = z.infer<typeof ExplainTask>;

export const Task = z.discriminatedUnion("type", [ChoiceTask, LocateTask, ExplainTask]);
export type Task = z.infer<typeof Task>;

export const Mission = z.object({
  id: Id,
  subStrandId: Id,
  title: LocalizedText,
  intro: LocalizedText,
  /** Estimated minutes, used to keep sessions under ~20 minutes. */
  minutes: z.number().int().positive().max(20),
  tasks: z.array(Task).min(3).max(6),
});
export type Mission = z.infer<typeof Mission>;

export const ReviewStatus = z.enum(["draft", "teacher-review", "approved"]);

export const ContentPack = z.object({
  schemaVersion: z.literal(1),
  id: Id,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: LocalizedText,
  country: z.string().length(2),
  grade: z.number().int().min(1).max(12),
  subject: z.string(),
  strand: z.object({ code: z.string(), title: LocalizedText }),
  /** Teacher sign-off state. Only "approved" packs may ship to children. */
  review: z.object({
    status: ReviewStatus,
    reviewedBy: z.string().nullable(),
    notes: z.string().optional(),
  }),
  printTarget: z.object({
    id: Id,
    size: z.enum(["A2", "A3", "A4"]),
    /** Geographic bounds printed on the sheet: [[west, south], [east, north]]. */
    bounds: z.tuple([LonLat, LonLat]),
  }),
  subStrands: z.array(SubStrand).min(1),
  skills: z.array(Skill).min(1),
  features: z.array(Feature),
  missions: z.array(Mission).min(1),
});
export type ContentPack = z.infer<typeof ContentPack>;
