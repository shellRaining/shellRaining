export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export interface CronJob {
  id: string;
  name: string;
  chatId: number;
  threadId: string;
  threadKey: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  createdAtMs: number;
  schedule: CronSchedule;
  payload: {
    kind: "agentTurn";
    message: string;
  };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "success" | "error" | "missed";
    lastError?: string;
    consecutiveErrors: number;
  };
}

export interface CronStoreData {
  version: 1;
  jobs: CronJob[];
}
