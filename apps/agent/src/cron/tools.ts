import { Type } from "@sinclair/typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import type { CronService, CronSchedule } from "@shellraining/cron";
import { normalizeCronJobInput, type CronJobInput } from "./normalize.js";
import type { AgentCronJob } from "./types.js";

/**
 * LLMs sometimes serialize nested objects as JSON strings in tool call params.
 * This helper parses a schedule value that may arrive as a string.
 */
function parseSchedule(raw: unknown): CronSchedule {
  if (typeof raw === "string") {
    return JSON.parse(raw) as CronSchedule;
  }
  return raw as CronSchedule;
}

function textResult(text: string): AgentToolResult<{ text: string }> {
  return {
    content: [{ type: "text" as const, text }],
    details: { text },
  };
}

function formatSchedule(job: AgentCronJob): string {
  if (job.schedule.kind === "at") {
    return `at ${job.schedule.at}`;
  }

  if (job.schedule.kind === "every") {
    return `every ${job.schedule.everyMs}ms`;
  }

  return job.schedule.tz !== undefined && job.schedule.tz !== ""
    ? `${job.schedule.expr} (${job.schedule.tz})`
    : job.schedule.expr;
}

function formatJob(job: AgentCronJob): string {
  return [
    `${job.name}（${job.id}）`,
    `schedule: ${formatSchedule(job)}`,
    `thread: ${job.owner.threadId}`,
    `enabled: ${job.enabled ? "yes" : "no"}`,
  ].join("\n");
}

export interface ThreadContext {
  chatId: number;
  threadId: string;
  threadKey: string;
}

export function buildCronExtensionFactory(
  service: CronService<AgentCronJob["payload"], AgentCronJob["owner"]>,
  thread: ThreadContext,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "cron_create",
      label: "Create cron job",
      description:
        "Create a scheduled cron job for the current chat thread. " +
        "Optional condition: a shell command checked before each run — exit 0 runs the job, exit 1 silently skips, exit 2+ counts as error. " +
        "Keep condition scripts short and avoid set -e. Only set timeoutMs when the check genuinely takes time.",
      parameters: Type.Object({
        name: Type.String({ minLength: 1 }),
        schedule: Type.Union([
          Type.Object({ kind: Type.Literal("at"), at: Type.String({ minLength: 1 }) }),
          Type.Object({
            kind: Type.Literal("every"),
            everyMs: Type.Integer({ minimum: 1 }),
            anchorMs: Type.Optional(Type.Integer()),
          }),
          Type.Object({
            kind: Type.Literal("cron"),
            expr: Type.String({ minLength: 1 }),
            tz: Type.Optional(Type.String()),
          }),
        ]),
        payload: Type.Object({
          kind: Type.Literal("agentTurn"),
          message: Type.String({ minLength: 1 }),
        }),
        condition: Type.Optional(
          Type.Object({
            command: Type.String({ minLength: 1 }),
            timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
          }),
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const job = await service.add(
          normalizeCronJobInput({
            ...params,
            schedule: parseSchedule(params.schedule),
            chatId: thread.chatId,
            threadId: thread.threadId,
            threadKey: thread.threadKey,
          } as CronJobInput),
        );
        return textResult(`已创建定时任务：${job.name}（${job.id}）`);
      },
    });

    pi.registerTool({
      name: "cron_list",
      label: "List cron jobs",
      description: "List scheduled cron jobs for the current chat.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        const jobs = (await service.listJobs()).filter((job) => job.owner.chatId === thread.chatId);
        if (jobs.length === 0) {
          return textResult("当前聊天没有定时任务。");
        }

        return textResult(jobs.map((job) => formatJob(job)).join("\n\n"));
      },
    });

    pi.registerTool({
      name: "cron_remove",
      label: "Remove cron job",
      description: "Remove a scheduled cron job by id.",
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const removed = await service.remove(params.id);
        return textResult(
          removed ? `已删除定时任务：${params.id}` : `未找到定时任务：${params.id}`,
        );
      },
    });
  };
}
