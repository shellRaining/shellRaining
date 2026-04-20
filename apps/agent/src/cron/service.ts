import { appendCurrentTimeLine } from "../runtime/time-awareness.js";
import { applyErrorBackoff, computeNextRunAtMs } from "./schedule.js";
import { findEarliestNextRunAtMs, planTimerDelayMs } from "./timer.js";
import type { CronJob, CronStoreData } from "./types.js";

const DEFAULT_CONDITION_TIMEOUT_MS = 30_000;

function resolveCronPromptTimezone(job: CronJob): string {
  if (job.schedule.kind !== "cron") {
    return "UTC";
  }

  const timezone = job.schedule.tz?.trim();
  return timezone || "UTC";
}

function appendCronCurrentTimeLine(message: string, job: CronJob, nowMs: number): string {
  if (job.schedule.kind !== "cron") {
    return message.trimEnd();
  }

  return appendCurrentTimeLine(message, {
    nowMs,
    timeZone: resolveCronPromptTimezone(job),
  });
}

export interface CronServiceStore {
  load(): Promise<CronStoreData>;
  save(data: CronStoreData): Promise<void>;
}

export interface CronServiceRuntime {
  prompt(threadKey: string, text: string, cwd: string): Promise<{ text: string; error?: string }>;
}

/**
 * Dependencies for `CronService`, injected so that time sources and timers
 * can be controlled in tests (e.g. fake `now()`, immediate `setTimeoutFn`).
 */
export interface CronServiceDeps {
  store: CronServiceStore;
  runtime: CronServiceRuntime;
  deliver: (threadId: string, text: string) => Promise<void>;
  workspaceForThreadKey: (threadKey: string) => Promise<string> | string;
  execCommand: (
    command: string,
    cwd: string,
    timeoutMs: number,
  ) => Promise<{ exitCode: number | null; signal?: NodeJS.Signals }>;
  now: () => number;
  setTimeoutFn: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;
  runTimeoutMs: number;
  /**
   * One-shot (`"at"`) jobs whose scheduled time is farther in the past than
   * this threshold are marked as "missed" at startup rather than executed.
   */
  misfireGraceMs: number;
}

export class CronService {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  /** Coalesces concurrent `runDueJobs` calls into a single execution. */
  private runningDueJobs: Promise<void> | undefined;

  constructor(private readonly deps: CronServiceDeps) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    await this.hydrateStartupJobs();
    await this.scheduleNextTimer();
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
  }

  async listJobs(): Promise<CronJob[]> {
    const data = await this.deps.store.load();
    return data.jobs;
  }

  async add(job: CronJob): Promise<CronJob> {
    const data = await this.deps.store.load();
    const nowMs = this.deps.now();
    const nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs);
    const nextJob: CronJob = {
      ...job,
      state: {
        ...job.state,
        nextRunAtMs,
      },
    };

    await this.deps.store.save({
      ...data,
      jobs: [...data.jobs, nextJob],
    });
    await this.scheduleNextTimer();
    return nextJob;
  }

  async remove(jobId: string): Promise<boolean> {
    const data = await this.deps.store.load();
    const jobs = data.jobs.filter((job) => job.id !== jobId);
    if (jobs.length === data.jobs.length) {
      return false;
    }

    await this.deps.store.save({
      ...data,
      jobs,
    });
    await this.scheduleNextTimer();
    return true;
  }

  async run(jobId: string): Promise<CronJob | undefined> {
    return this.runJob(jobId, true);
  }

  async runDueJobs(): Promise<void> {
    if (this.runningDueJobs) {
      return this.runningDueJobs;
    }

    this.runningDueJobs = this.runDueJobsInternal();
    try {
      await this.runningDueJobs;
    } finally {
      this.runningDueJobs = undefined;
    }
  }

  private async runDueJobsInternal(): Promise<void> {
    const data = await this.deps.store.load();
    const nowMs = this.deps.now();
    const dueJobs = data.jobs
      .filter(
        (job) =>
          job.enabled && job.state.nextRunAtMs !== undefined && job.state.nextRunAtMs <= nowMs,
      )
      .sort((left, right) => (left.state.nextRunAtMs ?? 0) - (right.state.nextRunAtMs ?? 0));

    for (const job of dueJobs) {
      await this.runJob(job.id, false);
    }

    await this.scheduleNextTimer();
  }

  private async runJob(jobId: string, rescheduleAfterRun: boolean): Promise<CronJob | undefined> {
    const data = await this.deps.store.load();
    const job = data.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      return undefined;
    }

    const nowMs = this.deps.now();

    try {
      const workspace = await this.deps.workspaceForThreadKey(job.threadKey);

      if (job.condition) {
        const condResult = await this.deps.execCommand(
          job.condition.command,
          workspace,
          job.condition.timeoutMs ?? DEFAULT_CONDITION_TIMEOUT_MS,
        );

        if (condResult.exitCode === 1) {
          const updated: CronJob = {
            ...job,
            state: {
              ...job.state,
              nextRunAtMs: computeNextRunAtMs(job.schedule, nowMs + 1),
            },
          };
          await this.saveUpdatedJob(data, updated);
          if (rescheduleAfterRun) {
            await this.scheduleNextTimer();
          }
          return updated;
        }

        if (condResult.exitCode !== 0) {
          const message = condResult.signal
            ? `Condition command terminated by signal ${condResult.signal}`
            : `Condition command exited with code ${condResult.exitCode}`;
          const updated = this.buildFailureJob(job, nowMs, message);
          await this.saveUpdatedJob(data, updated);
          if (rescheduleAfterRun) {
            await this.scheduleNextTimer();
          }
          return updated;
        }
      }

      const promptText = appendCronCurrentTimeLine(job.payload.message, job, nowMs);
      const result = await this.runWithTimeout(() =>
        this.deps.runtime.prompt(job.threadKey, promptText, workspace),
      );

      if (result.error) {
        const updated = this.buildFailureJob(job, nowMs, result.error);
        await this.saveUpdatedJob(data, updated);
        if (rescheduleAfterRun) {
          await this.scheduleNextTimer();
        }
        return updated;
      }

      const updated: CronJob = {
        ...job,
        state: {
          ...job.state,
          lastRunAtMs: nowMs,
          lastRunStatus: "success",
          lastError: undefined,
          consecutiveErrors: 0,
        },
      };

      await this.deps.deliver(job.threadId, result.text || "(no output)");

      if (job.deleteAfterRun) {
        await this.deps.store.save({
          ...data,
          jobs: data.jobs.filter((candidate) => candidate.id !== job.id),
        });
        if (rescheduleAfterRun) {
          await this.scheduleNextTimer();
        }
        return undefined;
      }

      // `nowMs + 1` avoids immediately re-scheduling an "every" job whose
      // interval aligns with the current millisecond.
      updated.state.nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs + 1);
      await this.saveUpdatedJob(data, updated);
      if (rescheduleAfterRun) {
        await this.scheduleNextTimer();
      }
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = this.buildFailureJob(job, nowMs, message);
      await this.saveUpdatedJob(data, updated);
      if (rescheduleAfterRun) {
        await this.scheduleNextTimer();
      }
      return updated;
    }
  }

  /**
   * At startup, mark one-shot (`"at"`) jobs that were missed while the service
   * was offline and recompute `nextRunAtMs` for all enabled jobs based on the
   * current time.
   */
  private async hydrateStartupJobs(): Promise<void> {
    const data = await this.deps.store.load();
    const nowMs = this.deps.now();
    let changed = false;

    const jobs = data.jobs.map((job) => {
      if (!job.enabled) {
        return job;
      }

      if (job.schedule.kind === "at") {
        const scheduledAtMs = Date.parse(job.schedule.at);
        if (Number.isFinite(scheduledAtMs) && nowMs - scheduledAtMs > this.deps.misfireGraceMs) {
          changed = true;
          return {
            ...job,
            enabled: false,
            state: {
              ...job.state,
              lastRunStatus: "missed" as const,
              lastError: "Missed scheduled run while service was offline",
              nextRunAtMs: undefined,
            },
          } satisfies CronJob;
        }
      }

      const nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs);
      if (job.state.nextRunAtMs === nextRunAtMs) {
        return job;
      }

      changed = true;
      return {
        ...job,
        state: {
          ...job.state,
          nextRunAtMs,
        },
      } satisfies CronJob;
    });

    if (!changed) {
      return;
    }

    await this.deps.store.save({
      ...data,
      jobs,
    });
  }

  /**
   * Auto-disable one-shot (`"at"`) jobs after 3 consecutive errors.
   * For recurring jobs, apply exponential backoff to `nextRunAtMs` instead.
   */
  private buildFailureJob(job: CronJob, nowMs: number, errorMessage: string): CronJob {
    const consecutiveErrors = job.state.consecutiveErrors + 1;
    const updated: CronJob = {
      ...job,
      state: {
        ...job.state,
        lastRunAtMs: nowMs,
        lastRunStatus: "error",
        lastError: errorMessage,
        consecutiveErrors,
      },
    };

    if (job.schedule.kind === "at" && consecutiveErrors >= 3) {
      updated.enabled = false;
      updated.state.nextRunAtMs = undefined;
      return updated;
    }

    // For one-shot jobs that haven't hit the error threshold yet, retry
    // immediately (from `nowMs`) so the next attempt happens soon.
    const normalNext = job.schedule.kind === "at" ? nowMs : computeNextRunAtMs(job.schedule, nowMs);
    updated.state.nextRunAtMs = applyErrorBackoff(normalNext, consecutiveErrors, nowMs);
    return updated;
  }

  private async saveUpdatedJob(data: CronStoreData, job: CronJob): Promise<void> {
    await this.deps.store.save({
      ...data,
      jobs: data.jobs.map((candidate) => (candidate.id === job.id ? job : candidate)),
    });
  }

  private async scheduleNextTimer(): Promise<void> {
    this.clearTimer();
    if (!this.started) {
      return;
    }

    const jobs = await this.listJobs();
    const nextRunAtMs = findEarliestNextRunAtMs(jobs);
    if (nextRunAtMs === undefined) {
      return;
    }

    const delayMs = planTimerDelayMs(nextRunAtMs, this.deps.now());
    this.timer = this.deps.setTimeoutFn(() => {
      void this.runDueJobs();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) {
      return;
    }

    this.deps.clearTimeoutFn(this.timer);
    this.timer = undefined;
  }

  private async runWithTimeout<T>(work: () => Promise<T>): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        work(),
        new Promise<T>((_, reject) => {
          timeoutHandle = this.deps.setTimeoutFn(() => {
            reject(new Error(`Cron job exceeded timeout of ${this.deps.runTimeoutMs}ms`));
          }, this.deps.runTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        this.deps.clearTimeoutFn(timeoutHandle);
      }
    }
  }
}
