export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export interface CronCondition {
  command: string;
  timeoutMs?: number;
}

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "success" | "error" | "missed";
  lastError?: string;
  consecutiveErrors: number;
}

export interface CronJob<TPayload = unknown, TOwner = unknown> {
  id: string;
  name: string;
  owner: TOwner;
  enabled: boolean;
  removeAfterSuccess: boolean;
  createdAtMs: number;
  schedule: CronSchedule;
  condition?: CronCondition;
  payload: TPayload;
  state: CronJobState;
}

export interface CronStoreData<TPayload = unknown, TOwner = unknown> {
  version: 1;
  jobs: CronJob<TPayload, TOwner>[];
}

export type CronExecutionResult = { status: "success" } | { status: "error"; error: string };

export type CronConditionResult =
  | { status: "pass" }
  | { status: "skip" }
  | { status: "error"; error: string };
