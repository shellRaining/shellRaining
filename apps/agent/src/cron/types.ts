import type { CronJob } from "@shellraining/cron";

export interface AgentCronOwner {
  chatId: number;
  threadId: string;
  threadKey: string;
}

export interface AgentCronPayload {
  kind: "agentTurn";
  message: string;
}

export type AgentCronJob = CronJob<AgentCronPayload, AgentCronOwner>;
