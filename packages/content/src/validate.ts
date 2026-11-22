/**
 * Semantic validation on top of the zod schema: cross-references that a JSON
 * schema cannot express. A pack that fails here must never reach a child.
 */
import { ContentPack, type Task } from "./schema.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  pack?: ContentPack;
  issues: ValidationIssue[];
}

export function validatePack(input: unknown): ValidationResult {
  const parsed = ContentPack.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const pack = parsed.data;
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message });

  const dupes = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err(label, `duplicate id "${id}"`);
      seen.add(id);
    }
  };

  const subStrandIds = new Set(pack.subStrands.map((s) => s.id));
  const skillIds = new Set(pack.skills.map((s) => s.id));
  const featureIds = new Set(pack.features.map((f) => f.id));
  const allTasks: Task[] = pack.missions.flatMap((m) => m.tasks);

  dupes("subStrands", pack.subStrands.map((s) => s.id));
  dupes("skills", pack.skills.map((s) => s.id));
  dupes("features", pack.features.map((f) => f.id));
  dupes("missions", pack.missions.map((m) => m.id));
  dupes(
    "tasks",
    allTasks.flatMap((t) => (t.type === "explain" ? [t.id, t.followUp.id] : [t.id])),
  );

  for (const s of pack.skills) {
    if (!subStrandIds.has(s.subStrandId)) err(`skills.${s.id}`, `unknown subStrand "${s.subStrandId}"`);
  }

  const skillsWithExplain = new Set<string>();
  pack.missions.forEach((m, mi) => {
    const mp = `missions[${mi}](${m.id})`;
    if (!subStrandIds.has(m.subStrandId)) err(mp, `unknown subStrand "${m.subStrandId}"`);
    if (!m.tasks.some((t) => t.type === "explain")) {
      err(mp, "every mission must end in an explanation task");
    } else if (m.tasks.at(-1)?.type !== "explain") {
      err(mp, "the explanation task must be the last task");
    }

    m.tasks.forEach((t, ti) => {
      const tp = `${mp}.tasks[${ti}](${t.id})`;
      if (!skillIds.has(t.skillId)) err(tp, `unknown skill "${t.skillId}"`);
      if (t.type === "choice") checkChoice(tp, t.options.map((o) => o.id), t.correctOptionIds, err);
      if (t.type === "locate" && !featureIds.has(t.featureId)) err(tp, `unknown feature "${t.featureId}"`);
      if (t.type === "explain") {
        skillsWithExplain.add(t.skillId);
        // Ids are unique inside one task: the local checker counts criteria by id, and the session
        // shows the hint it finds by id (findings register CR30, CR31). Across tasks they may repeat.
        const repeated = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
        for (const id of new Set(repeated(t.rubric.criteria.map((c) => c.id)))) err(`${tp}.rubric`, `duplicate criterion id "${id}"`);
        for (const id of new Set(repeated(t.hints.map((h) => h.id)))) err(`${tp}.hints`, `duplicate hint id "${id}"`);
        const criteria = new Set(t.rubric.criteria.map((c) => c.id));
        if (t.rubric.minCriteria > criteria.size) err(tp, "minCriteria exceeds number of criteria");
        for (const h of t.hints) {
          if (!criteria.has(h.criterionId)) err(`${tp}.hints.${h.id}`, `unknown criterion "${h.criterionId}"`);
        }
        if (t.followUp.skillId !== t.skillId) err(`${tp}.followUp`, "follow-up must evidence the same skill");
        checkChoice(`${tp}.followUp`, t.followUp.options.map((o) => o.id), t.followUp.correctOptionIds, err);
      }
    });
  });

  // Mastery needs an explanation per skill (see packages/mastery rules).
  for (const s of pack.skills) {
    if (!skillsWithExplain.has(s.id)) err(`skills.${s.id}`, "skill has no explanation task, so it can never be mastered");
  }

  return { ok: issues.length === 0, pack, issues };
}

function checkChoice(
  path: string,
  optionIds: string[],
  correct: string[],
  err: (p: string, m: string) => void,
) {
  const ids = new Set(optionIds);
  if (ids.size !== optionIds.length) err(path, "duplicate option ids");
  for (const c of correct) if (!ids.has(c)) err(path, `correct option "${c}" is not an option`);
}
