import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config as loadEnv } from "dotenv";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { CronService } from "./cron/service.js";
import { CronStore } from "./cron/store.js";
import { buildCronExtensionFactory } from "./cron/tools.js";
import { PiRuntime } from "./pi/runtime.js";
import { getThreadIdFromKey, getChatIdFromThreadKey } from "./pi/session-store.js";
import { syncPiSettings } from "./runtime/pi-settings.js";
import { getWorkspace } from "./runtime/workspace.js";

loadEnv();

if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy) {
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
});
runtime = new PiRuntime(config, {
  extensionFactories: (threadKey) => {
    const threadId = getThreadIdFromKey(threadKey);
    const chatId = getChatIdFromThreadKey(threadKey);
    return [buildCronExtensionFactory(cronService, { chatId, threadId, threadKey })];
  },
});
const botRuntime = createBot(config, runtime);
await cronService.start();
const app = new Hono();

app.get("/", (c) => c.text("shellRaining is running"));
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/webhook/telegram", async (c) => botRuntime.chat.webhooks.telegram(c.req.raw));

serve({
  fetch: app.fetch,
  port: config.port,
});
