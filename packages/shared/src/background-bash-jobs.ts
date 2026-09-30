import {
  collectVisibleMyCodeBackgroundTaskControlItems,
  getMyCodeBackgroundTaskControlItemElapsedMs,
  isActiveMyCodeBackgroundTaskControlItem,
  parseMyCodeBackgroundTaskControlItems,
  type MyCodeBackgroundTaskControlItem,
  type MyCodeBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type MyCodeBackgroundBashJobStatus = MyCodeBackgroundTaskControlStatus;
export type MyCodeBackgroundBashJob = MyCodeBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseMyCodeBackgroundBashJobs(value: unknown): MyCodeBackgroundBashJob[] {
  return parseMyCodeBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveMyCodeBackgroundBashJob(job: MyCodeBackgroundBashJob): boolean {
  return isActiveMyCodeBackgroundTaskControlItem(job);
}

export function getMyCodeBackgroundBashJobElapsedMs(
  job: MyCodeBackgroundBashJob,
  now = Date.now(),
): number {
  return getMyCodeBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleMyCodeBackgroundBashJobs(
  jobs: readonly MyCodeBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<MyCodeBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleMyCodeBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    MyCodeBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: MyCodeBackgroundTaskControlItem): job is MyCodeBackgroundBashJob {
  return job.taskKind === "bash";
}
