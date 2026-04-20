/**
 * Supported cron schedule variants.
 *
 * - `"at"`: One-shot — fire once at an absolute ISO 8601 timestamp, then auto-disable.
 * - `"every"`: Fixed-interval — fire every N milliseconds, optionally anchored to a base timestamp.
 * - `"cron"`: Standard cron expression with an optional IANA timezone (defaults to UTC).
 */
export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export interface CronCondition {
  command: string;
  timeoutMs?: number;
}

/** A persistent, scheduled task that sends prompts to the Pi agent on a recurring or one-shot basis. */
export interface CronJob {
  /** Unique identifier (UUID). */
  id: string;
  /** Human-readable label shown in the Telegram job list. */
  name: string;
  /** Telegram chat ID that owns this job. */
  chatId: number;
  /** Pi session thread ID for routing the prompt. */
  threadId: string;
  /** Persistent key used to look up the Pi session directory. */
  threadKey: string;
  /** Whether the job is active. Disabled jobs are kept in the store but never run. */
  enabled: boolean;
  /** Auto-disable after the first successful run (used by `"at"` schedules). */
  deleteAfterRun: boolean;
  /** Epoch milliseconds when the job was created. */
  createdAtMs: number;
  schedule: CronSchedule;
  condition?: CronCondition;
  payload: {
    kind: "agentTurn";
    /** The text prompt sent to the Pi agent when the job fires. */
    message: string;
  };
  state: {
    /** Epoch ms of the next scheduled run. `undefined` before the first computation. */
    nextRunAtMs?: number;
    /** Epoch ms of the most recent run. */
    lastRunAtMs?: number;
    /** Outcome of the most recent run. `"missed"` means the job was due while the server was down. */
    lastRunStatus?: "success" | "error" | "missed";
    /** Error message from the last failed run. */
    lastError?: string;
    /** Consecutive error count — used for exponential backoff and auto-disable at 3 errors. */
    consecutiveErrors: number;
  };
}

/** On-disk format for the cron jobs JSON file. */
export interface CronStoreData {
  /** Schema version for future migrations. */
  version: 1;
  jobs: CronJob[];
}
