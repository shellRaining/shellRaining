import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "./config.js";
import { createBot } from "./bot.js";
import { syncPiSettings } from "./runtime/pi-settings.js";

loadEnv();

const config = loadConfig();
await syncPiSettings({
  agentDir: config.agentDir,
  backupDir: `${config.baseDir}/backups`,
  skillsDir: config.skillsDir,
});

const bot = createBot(config);
const app = new Hono();

app.get("/", (c) => c.text("shell-raining is running"));
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/webhook/telegram", async (c) => bot.webhooks.telegram(c.req.raw));

serve({
  fetch: app.fetch,
  port: config.port,
});
