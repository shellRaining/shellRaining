import { nanoid } from "nanoid";
import type { CronJob, CronSchedule } from "./types.js";

export interface CronJobInput {
  name: string;
  chatId: number;
  threadId: string;
  threadKey: string;
  schedule: CronSchedule;
  payload: {
    kind: "agentTurn";
    message: string;
  };
}

export function normalizeCronJobInput(input: CronJobInput): CronJob {
  const name = input.name.trim();
  const message = input.payload.message.trim();

  if (!name) {
    throw new Error("Cron job name is required");
  }

  if (!message) {
    throw new Error("Cron job payload message is required");
  }

  if (!Number.isInteger(input.chatId)) {
    throw new Error("Cron job chatId must be an integer");
  }

  return {
    id: nanoid(),
    name,
    chatId: input.chatId,
    threadId: input.threadId,
    threadKey: input.threadKey,
    enabled: true,
    // `deleteAfterRun` is a misnomer: the job is not deleted on success but
    // rather auto-disabled after 3 consecutive errors. For one-shot ("at") jobs
    // it is set to `true` so that successful runs remove the job entirely.
    deleteAfterRun: input.schedule.kind === "at",
    createdAtMs: Date.now(),
    schedule: input.schedule,
    payload: {
      kind: "agentTurn",
      message,
    },
    state: {
      consecutiveErrors: 0,
    },
  };
}
