import { nanoid } from "nanoid";
import type { CronCondition, CronSchedule } from "@shellraining/cron";
import type { AgentCronJob } from "./types.js";

export interface CronJobInput {
  name: string;
  chatId: number;
  threadId: string;
  threadKey: string;
  schedule: CronSchedule;
  condition?: CronCondition;
  payload: {
    kind: "agentTurn";
    message: string;
  };
}

export function normalizeCronJobInput(input: CronJobInput): AgentCronJob {
  const name = input.name.trim();
  const message = input.payload.message.trim();

  if (!name) {
    throw new Error("Cron job name is required");
  }

  if (!message) {
    throw new Error("Cron job payload message is required");
  }

  if (!Number.isInteger(input.chatId)) {
    throw new TypeError("Cron job chatId must be an integer");
  }

  let condition: CronCondition | undefined;
  if (input.condition) {
    const command = input.condition.command.trim();
    if (!command) {
      throw new Error("Cron job condition command is required");
    }
    if (
      input.condition.timeoutMs !== undefined &&
      (!Number.isInteger(input.condition.timeoutMs) || input.condition.timeoutMs <= 0)
    ) {
      throw new TypeError("Cron job condition timeout must be a positive integer");
    }
    condition = {
      command,
      ...(input.condition.timeoutMs !== undefined && { timeoutMs: input.condition.timeoutMs }),
    };
  }

  return {
    id: nanoid(),
    name,
    owner: {
      chatId: input.chatId,
      threadId: input.threadId,
      threadKey: input.threadKey,
    },
    enabled: true,
    removeAfterSuccess: input.schedule.kind === "at",
    createdAtMs: Date.now(),
    schedule: input.schedule,
    condition,
    payload: {
      kind: "agentTurn",
      message,
    },
    state: {
      consecutiveErrors: 0,
    },
  };
}
