import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config as loadEnv } from "dotenv";
import { createBot } from "./bot.js";
import { createConfigService } from "./config.js";
import { ExecaError, execa } from "execa";
import {
  CronService,
  CronStore,
  type CronCondition,
  type CronConditionResult,
} from "@shellraining/cron";
import { buildCronExtensionFactory } from "./cron/tools.js";
import type { AgentCronJob, AgentCronOwner, AgentCronPayload } from "./cron/types.js";
import { PiRuntime } from "./pi/runtime.js";
import { getThreadIdFromKey, getChatIdFromThreadKey } from "./pi/session-store.js";
import { appendCurrentTimeLine } from "./runtime/time-awareness.js";
import { getWorkspace } from "./runtime/workspace.js";

loadEnv({ path: "../../.env" });

// When running behind an HTTP proxy (e.g. in a container), undici needs explicit
// global dispatcher setup — Node's built-in fetch doesn't respect *_PROXY env vars.
if (
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.https_proxy
) {
  const undici = (await import("undici")) as {
    EnvHttpProxyAgent: new () => unknown;
    setGlobalDispatcher: (dispatcher: unknown) => void;
  };
  undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
}

const configService = await createConfigService();
await configService.start();
const config = configService.current();
const currentConfig = () => configService.current();
const cronStore = new CronStore<AgentCronPayload, AgentCronOwner>(config.cron.jobsPath);

async function execCommand(command: string, cwd: string, timeoutMs: number) {
  try {
    await execa({ cwd, timeout: timeoutMs })`bash -c ${command}`;
    return { exitCode: 0 as const };
  } catch (error) {
    if (error instanceof ExecaError) {
      if (error.isTerminated) {
        return { exitCode: null, signal: error.signal };
      }
      if (error.exitCode !== undefined) {
        return { exitCode: error.exitCode, signal: error.signal };
      }
    }
    throw error;
  }
}

function resolveCronPromptTimezone(job: AgentCronJob): string {
  if (job.schedule.kind !== "cron") {
    return "UTC";
  }

  const timezone = job.schedule.tz?.trim();
  return timezone || "UTC";
}

function buildCronPromptText(job: AgentCronJob, nowMs: number): string {
  if (job.schedule.kind !== "cron") {
    return job.payload.message.trimEnd();
  }

  return appendCurrentTimeLine(job.payload.message, {
    nowMs,
    timeZone: resolveCronPromptTimezone(job),
  });
}

async function runCronCondition(
  condition: CronCondition,
  job: AgentCronJob,
): Promise<CronConditionResult> {
  const workspace = await getWorkspace(job.owner.threadKey, config.paths.workspace);
  const result = await execCommand(condition.command, workspace, condition.timeoutMs ?? 30_000);

  if (result.exitCode === 0) {
    return { status: "pass" };
  }

  if (result.exitCode === 1) {
    return { status: "skip" };
  }

  return {
    status: "error",
    error: result.signal
      ? `Condition command terminated by signal ${result.signal}`
      : `Condition command exited with code ${result.exitCode}`,
  };
}

let runtime: PiRuntime;
const cronService = new CronService<AgentCronPayload, AgentCronOwner>({
  store: cronStore,
  async execute(job, nowMs) {
    const workspace = await getWorkspace(job.owner.threadKey, config.paths.workspace);
    const promptText = buildCronPromptText(job, nowMs);
    const result = await runtime.prompt(
      { agentId: config.telegram.defaultAgent, threadKey: job.owner.threadKey },
      promptText,
      workspace,
    );

    if (result.error) {
      return { status: "error", error: result.error };
    }

    await botRuntime.telegram.postCronMessage(job.owner.threadId, result.text || "(no output)");
    return { status: "success" };
  },
  async runCondition(condition, job) {
    try {
      return await runCronCondition(condition, job);
    } catch (error) {
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  },
  now: () => Date.now(),
  setTimeoutFn: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeoutFn: (handle) => clearTimeout(handle),
  runTimeoutMs: config.cron.runTimeoutMs,
  misfireGraceMs: config.cron.misfireGraceMs,
});
runtime = new PiRuntime(currentConfig, {
  extensionFactories: (threadKey) => {
    const threadId = getThreadIdFromKey(threadKey);
    const chatId = getChatIdFromThreadKey(threadKey);
    return [buildCronExtensionFactory(cronService, { chatId, threadId, threadKey })];
  },
});
const botRuntime = createBot(currentConfig, runtime);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`[shellRaining] shutting down on ${signal}`);
  await configService.stop();
  await runtime.dispose();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await cronService.start();
const app = new Hono();

app.get("/", (c) => c.text("shellRaining is running"));
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/webhook/telegram", async (c) => botRuntime.chat.webhooks.telegram(c.req.raw));

serve({
  fetch: app.fetch,
  port: config.server.port,
});
