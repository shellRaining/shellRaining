import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { Chat, type Thread } from "chat";
import type { Config } from "./config.js";
import { checkRateLimit } from "./runtime/rate-limiter.js";
import { detectFiles, snapshotWorkspace } from "./runtime/artifact-detector.js";
import { splitMessage } from "./runtime/message-splitter.js";
import { formatPath, getWorkspace, setWorkspace } from "./runtime/workspace.js";
import { PiRuntime } from "./pi/runtime.js";
import { getThreadKeyFromId } from "./pi/session-store.js";

function parseCommand(messageText: string | null | undefined): { command: string; args: string } | null {
  const text = messageText?.trim();
  if (!text?.startsWith("/")) {
    return null;
  }

  const [rawCommand, ...rest] = text.split(/\s+/);
  const command = rawCommand?.split("@")[0]?.slice(1) || "";
  return { command, args: rest.join(" ").trim() };
}

async function replyLong(thread: Thread, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) {
    await thread.post(chunk);
  }
}

async function handleCommand(thread: Thread, messageText: string, config: Config, runtime: PiRuntime): Promise<boolean> {
  const parsed = parseCommand(messageText);
  if (!parsed) {
    return false;
  }

  const threadKey = getThreadKeyFromId(thread.id);
  const currentWorkspace = await getWorkspace(threadKey, config.workspace);

  switch (parsed.command) {
    case "start":
      await thread.post(`shellRaining 已连接。\n当前目录：${formatPath(currentWorkspace)}`);
      return true;
    case "help":
      await thread.post([
        "可用命令：",
        "/start",
        "/help",
        "/pwd",
        "/cd <path>",
        "/home",
        "/new",
        "/status",
      ].join("\n"));
      return true;
    case "pwd":
      await thread.post(formatPath(currentWorkspace));
      return true;
    case "home": {
      const nextWorkspace = await setWorkspace(threadKey, "~", config.workspace);
      await thread.post(formatPath(nextWorkspace));
      return true;
    }
    case "cd": {
      const nextWorkspace = await setWorkspace(threadKey, parsed.args || "~", config.workspace);
      await thread.post(formatPath(nextWorkspace));
      return true;
    }
    case "new":
      await runtime.newSession(threadKey, currentWorkspace);
      await thread.post("已创建新会话。后续消息会使用新的 Pi session。");
      return true;
    case "status":
      await thread.post(`thread=${thread.id}\nworkspace=${formatPath(currentWorkspace)}\nskills=${config.skillsDir}`);
      return true;
    default:
      return false;
  }
}

async function handlePrompt(thread: Thread, messageText: string, config: Config, runtime: PiRuntime): Promise<void> {
  const threadKey = getThreadKeyFromId(thread.id);
  const allowed = checkRateLimit(Number.parseInt(thread.channelId.replace(/\D/g, "") || "0", 10), config.rateLimitCooldownMs);
  if (!allowed.allowed) {
    await thread.post(`请等待 ${Math.ceil((allowed.retryAfterMs || 0) / 1000)} 秒后再发送下一条消息。`);
    return;
  }

  const workspace = await getWorkspace(threadKey, config.workspace);
  const beforeSnapshot = await snapshotWorkspace(workspace);
  await thread.startTyping();

  const result = await runtime.prompt(threadKey, messageText, workspace, {
    onStatus: async (status) => {
      await thread.startTyping(status);
    },
  });

  if (result.error) {
    await thread.post(`执行失败：${result.error}`);
  }

  if (result.text) {
    await replyLong(thread, result.text);
  }

  const files = await detectFiles(result.artifactsOutput, workspace, beforeSnapshot);
  for (const file of files) {
    await thread.post(`生成文件：${file.filename}\n${file.path}`);
  }
}

export function createBot(config: Config): Chat {
  const runtime = new PiRuntime(config);
  const bot = new Chat({
    userName: "shellRaining_bot",
    adapters: {
      telegram: createTelegramAdapter({
        botToken: config.telegramToken,
        secretToken: config.telegramWebhookSecret,
        mode: "webhook",
      }),
    },
    logger: "info",
    state: createMemoryState(),
  });

  bot.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    if (await handleCommand(thread, message.text || "", config, runtime)) {
      return;
    }
    await handlePrompt(thread, message.text || "", config, runtime);
  });

  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    if (await handleCommand(thread, message.text || "", config, runtime)) {
      return;
    }
    await handlePrompt(thread, message.text || "", config, runtime);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    if (await handleCommand(thread, message.text || "", config, runtime)) {
      return;
    }
    await handlePrompt(thread, message.text || "", config, runtime);
  });

  return bot;
}
