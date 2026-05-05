import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config as loadEnv } from "dotenv";
import { createBot } from "./bot.js";
import { ConfigService, loadConfig } from "./config/index.js";
import { ExecaError, execa } from "execa";
import {
  CronService,
  CronStore,
  type CronCondition,
  type CronConditionResult,
} from "@shellraining/cron";
import { buildCronExtensionFactory } from "./cron/tools.js";
import type { AgentCronJob, AgentCronOwner, AgentCronPayload } from "./cron/types.js";
import { createLogService } from "./logging/service.js";
import { PiRuntime } from "./pi/runtime.js";
import { getThreadIdFromKey, getChatIdFromThreadKey } from "./pi/session-store.js";
import { appendCurrentTimeLine } from "./runtime/time-awareness.js";
import { getWorkspace } from "./runtime/workspace.js";

loadEnv({ path: "../../.env" });

// When running behind an HTTP proxy (e.g. in a container), undici needs explicit
// global dispatcher setup — Node's built-in fetch doesn't respect *_PROXY env vars.
if (
  process.env.HTTP_PROXY !== undefined ||
  process.env.HTTPS_PROXY !== undefined ||
  process.env.http_proxy !== undefined ||
  process.env.https_proxy !== undefined
) {
  const undici = await import("undici");
  const EnvHttpProxyAgent = undici.EnvHttpProxyAgent;
  const setGlobalDispatcher = undici.setGlobalDispatcher;
  if (typeof setGlobalDispatcher === "function" && typeof EnvHttpProxyAgent === "function") {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}

const initialConfig = await loadConfig();
const logService = createLogService(initialConfig.logging);
const logger = logService.child({ component: "app" });
logger.info({ event: "app.start" }, "shellRaining starting");
const configService = new ConfigService(initialConfig, logService.child({ component: "config" }));
await configService.start();
configService.subscribe((nextConfig) => {
  logService.setLevel(nextConfig.logging.level);
});
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
  return timezone ?? "UTC";
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
  const startedAt = Date.now();
  logger.info(
    { event: "cron.condition.start", jobId: job.id, threadKey: job.owner.threadKey },
    "cron condition started",
  );
  const workspace = await getWorkspace(job.owner.threadKey, config.paths.workspace);
  const result = await execCommand(condition.command, workspace, condition.timeoutMs ?? 30_000);

  if (result.exitCode === 0) {
    logger.info(
      {
        durationMs: Date.now() - startedAt,
        event: "cron.condition.finish",
        jobId: job.id,
        status: "pass",
        threadKey: job.owner.threadKey,
      },
      "cron condition passed",
    );
    return { status: "pass" };
  }

  if (result.exitCode === 1) {
    logger.info(
      {
        durationMs: Date.now() - startedAt,
        event: "cron.condition.finish",
        jobId: job.id,
        status: "skip",
        threadKey: job.owner.threadKey,
      },
      "cron condition skipped",
    );
    return { status: "skip" };
  }

  logger.warn(
    {
      durationMs: Date.now() - startedAt,
      event: "cron.condition.finish",
      exitCode: result.exitCode,
      jobId: job.id,
      signal: result.signal,
      status: "error",
      threadKey: job.owner.threadKey,
    },
    "cron condition failed",
  );
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
    const startedAt = Date.now();
    logger.info(
      { event: "cron.execute.start", jobId: job.id, threadKey: job.owner.threadKey },
      "cron job execution started",
    );
    const workspace = await getWorkspace(job.owner.threadKey, config.paths.workspace);
    const promptText = buildCronPromptText(job, nowMs);
    const result = await runtime.prompt(
      { agentId: config.telegram.defaultAgent, threadKey: job.owner.threadKey },
      promptText,
      workspace,
    );

    if (result.error !== undefined) {
      logger.error(
        {
          durationMs: Date.now() - startedAt,
          event: "cron.execute.finish",
          jobId: job.id,
          status: "error",
          threadKey: job.owner.threadKey,
        },
        "cron job execution failed",
      );
      return { status: "error", error: result.error };
    }

    await botRuntime.telegram.postCronMessage(job.owner.threadId, result.text ?? "(no output)");
    logger.info(
      {
        durationMs: Date.now() - startedAt,
        event: "cron.execute.finish",
        jobId: job.id,
        status: "success",
        threadKey: job.owner.threadKey,
      },
      "cron job execution finished",
    );
    return { status: "success" };
  },
  async runCondition(condition, job) {
    try {
      return await runCronCondition(condition, job);
    } catch (error) {
      logger.error(
        { error, event: "cron.condition.error", jobId: job.id, threadKey: job.owner.threadKey },
        "cron condition threw an error",
      );
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  },
  now: () => Date.now(),
  setTimeoutFn: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeoutFn: (handle) => {
    clearTimeout(handle);
  },
  runTimeoutMs: config.cron.runTimeoutMs,
  misfireGraceMs: config.cron.misfireGraceMs,
});
runtime = new PiRuntime(currentConfig, {
  extensionFactories: (threadKey) => {
    const threadId = getThreadIdFromKey(threadKey);
    const chatId = getChatIdFromThreadKey(threadKey);
    return [buildCronExtensionFactory(cronService, { chatId, threadId, threadKey })];
  },
  logger: logService.child({ component: "pi-runtime" }),
});
const botRuntime = createBot(currentConfig, runtime, logService.child({ component: "bot" }));

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ event: "app.shutdown", signal }, "shutting down");
  await configService.stop();
  await runtime.dispose();
  await logService.stop();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await cronService.start();
logger.info({ event: "cron.start" }, "cron service started");
const app = new Hono();

app.get("/", (c) => c.text("shellRaining is running"));
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/webhook/telegram", (c) => botRuntime.chat.webhooks.telegram(c.req.raw));

serve({
  fetch: app.fetch,
  port: config.server.port,
});
logger.info({ event: "http.listen", port: config.server.port }, "HTTP server listening");
