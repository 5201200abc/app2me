import type { MyCodeBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeMyCodeBackgroundTaskControlItems(
  current: readonly MyCodeBackgroundTaskControlItem[],
  updates: readonly MyCodeBackgroundTaskControlItem[],
): MyCodeBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
