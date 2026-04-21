import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config as loadEnv } from "dotenv";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CronService } from "./cron/service.js";
import { CronStore } from "./cron/store.js";
import { buildCronExtensionFactory } from "./cron/tools.js";
import { PiRuntime } from "./pi/runtime.js";
import { getThreadIdFromKey, getChatIdFromThreadKey } from "./pi/session-store.js";
import { syncPiSettings } from "./runtime/pi-settings.js";
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

const config = loadConfig();
await syncPiSettings({
  agentDir: config.agentDir,
  backupDir: `${config.baseDir}/backups`,
  skillsDir: config.skillsDir,
});

const cronStore = new CronStore(config.cron.jobsPath);
const execFileAsync = promisify(execFile);

async function execCommand(command: string, cwd: string, timeoutMs: number) {
  try {
    await execFileAsync("bash", ["-c", command], {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0 as const };
  } catch (error) {
    const details = error as NodeJS.ErrnoException & {
      code?: string | number;
      signal?: NodeJS.Signals;
      killed?: boolean;
    };

    if (typeof details.code === "number") {
      return { exitCode: details.code, signal: details.signal };
    }

    if (details.signal) {
      return { exitCode: null, signal: details.signal };
    }

    throw error;
  }
}

let runtime: PiRuntime;
const cronService = new CronService({
  store: cronStore,
  runtime: {
    prompt: (threadKey, text, cwd) => runtime.prompt(threadKey, text, cwd),
  },
  deliver: (threadId, text) => botRuntime.telegram.postCronMessage(threadId, text),
  workspaceForThreadKey: (threadKey) => getWorkspace(threadKey, config.workspace),
  now: () => Date.now(),
  setTimeoutFn: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeoutFn: (handle) => clearTimeout(handle),
  runTimeoutMs: config.cron.runTimeoutMs,
  misfireGraceMs: config.cron.misfireGraceMs,
  execCommand,
});
runtime = new PiRuntime(config, {
  extensionFactories: (threadKey) => {
    const threadId = getThreadIdFromKey(threadKey);
    const chatId = getChatIdFromThreadKey(threadKey);
    return [buildCronExtensionFactory(cronService, { chatId, threadId, threadKey })];
  },
});
const botRuntime = createBot(config, runtime);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`[shellRaining] shutting down on ${signal}`);
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
  port: config.port,
});
