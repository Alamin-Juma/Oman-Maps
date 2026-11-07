import type { ContentPack, ExplainTask, Mission, Task } from "./schema.js";

export interface TaskRef {
  mission: Mission;
  task: Task;
}

/** Index every task (including explain follow-ups) by id. */
export function indexTasks(pack: ContentPack): Map<string, TaskRef> {
  const map = new Map<string, TaskRef>();
  for (const mission of pack.missions) {
    for (const task of mission.tasks) {
      map.set(task.id, { mission, task });
      if (task.type === "explain") map.set(task.followUp.id, { mission, task: task.followUp });
    }
  }
  return map;
}

export function findExplainTask(pack: ContentPack, taskId: string): ExplainTask | undefined {
  const ref = indexTasks(pack).get(taskId);
  return ref?.task.type === "explain" ? ref.task : undefined;
}

/** Map skillId -> subStrandId, used by the review scheduler to interleave topics. */
export function skillTopics(pack: ContentPack): Record<string, string> {
  return Object.fromEntries(pack.skills.map((s) => [s.id, s.subStrandId]));
}
