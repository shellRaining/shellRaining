import { readFile } from "node:fs/promises";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { Chat, type Thread } from "chat";
import { readConfig, type Config, type ConfigSource } from "./config/index.js";
import { isUserAllowed } from "./runtime/access-control.js";
import { detectFiles, snapshotWorkspace } from "./runtime/artifact-detector.js";
import { splitMessage } from "./runtime/message-splitter.js";
import { injectPromptTimestampPrefix } from "./runtime/time-awareness.js";
import {
  normalizeTelegramInput,
  type NormalizedTelegramInput,
  type TelegramInputMessage,
} from "./runtime/telegram-input.js";
import {
  configureWorkspaceState,
  formatPath,
  getWorkspace,
  setWorkspace,
} from "./runtime/workspace.js";
import { PiRuntime } from "./pi/runtime.js";
import { getThreadKeyFromId } from "./pi/session-store.js";

function getDefaultRuntimeScope(
  config: Config,
  threadKey: string,
): { agentId: string; threadKey: string } {
  return { agentId: config.telegram.defaultAgent, threadKey };
}

/** Strips the `@botname` suffix that Telegram adds in group mentions (e.g. `/start@mybot` → `/start`). */
function parseCommand(
  messageText: string | null | undefined,
): { command: string; args: string } | null {
  const text = messageText?.trim();
  if (!text?.startsWith("/")) {
    return null;
  }

  const [rawCommand, ...rest] = text.split(/\s+/);
  const command = rawCommand?.split("@")[0]?.slice(1) || "";
  return { command, args: rest.join(" ").trim() };
}

export function toTelegramReplyMessage(text: string): { markdown: string } {
  return { markdown: text };
}

export const TELEGRAM_CONCURRENCY = {
  strategy: "debounce",
  debounceMs: 1200,
} as const;

export interface BotRuntime {
  chat: Chat;
  runtime: PiRuntime;
  telegram: {
    postCronMessage(threadId: string, text: string): Promise<void>;
  };
}

/** Telegram's MarkdownV2 parser rejects malformed entities; fall back to plain text when that happens. */
export function shouldFallbackToRawTelegramReply(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const typedError = error as Error & { code?: string };
  return typedError.code === "VALIDATION_ERROR" && error.message.includes("can't parse entities");
}

export function isTelegramInputProcessable(input: NormalizedTelegramInput): boolean {
  return input.isProcessable;
}

export function formatTelegramStatusMessage(input: {
  agentDisplayName: string;
  agentId: string;
  piProfile: string;
  profileRoot: string;
  telegramApiBaseUrl?: string;
  threadId: string;
  workspace: string;
}): string {
  const telegramApi = input.telegramApiBaseUrl || "https://api.telegram.org";
  return [
    `thread=${input.threadId}`,
    `workspace=${formatPath(input.workspace)}`,
    `agent=${input.agentId}`,
    `agentName=${input.agentDisplayName}`,
    `piProfile=${input.piProfile}`,
    `profileRoot=${input.profileRoot}`,
    `telegramApi=${telegramApi}`,
  ].join("\n");
}

export function hasPotentialTelegramInput(message: TelegramInputMessage): boolean {
  return Boolean(message.text?.trim() || message.attachments?.length || message.raw?.sticker);
}

/**
 * Splits `text` at the 4096-char Telegram limit, sending each chunk as a separate message.
 * Tries Markdown first; on Telegram parse errors, falls back to raw text for that chunk.
 */
async function replyLong(thread: Thread, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) {
    try {
      await thread.post(toTelegramReplyMessage(chunk));
    } catch (error) {
      if (!shouldFallbackToRawTelegramReply(error)) {
        throw error;
      }
      await thread.post(chunk);
    }
  }
}

async function sendDetectedFile(
  thread: Thread,
  file: { filename: string; path: string },
): Promise<void> {
  const data = await readFile(file.path);
  await thread.post({
    raw: file.filename,
    files: [
      {
        data,
        filename: file.filename,
      },
    ],
  });
}

async function handleCommand(
  thread: Thread,
  messageText: string,
  config: Config,
  runtime: PiRuntime,
): Promise<boolean> {
  const parsed = parseCommand(messageText);
  if (!parsed) {
    return false;
  }

  const threadKey = getThreadKeyFromId(thread.id);
  const scope = getDefaultRuntimeScope(config, threadKey);
  const currentWorkspace = await getWorkspace(threadKey, config.paths.workspace);

  switch (parsed.command) {
    case "start":
      await thread.post(`shellRaining 已连接。\n当前目录：${formatPath(currentWorkspace)}`);
      return true;
    case "help":
      await thread.post(
        [
          "可用命令：",
          "/start",
          "/help",
          "/pwd",
          "/cd <path>",
          "/home",
          "/session",
          "/session switch <n>",
          "/new",
          "/status",
        ].join("\n"),
      );
      return true;
    case "pwd":
      await thread.post(formatPath(currentWorkspace));
      return true;
    case "home": {
      const nextWorkspace = await setWorkspace(threadKey, "~", config.paths.workspace);
      await thread.post(formatPath(nextWorkspace));
      return true;
    }
    case "cd": {
      const nextWorkspace = await setWorkspace(
        threadKey,
        parsed.args || "~",
        config.paths.workspace,
      );
      await thread.post(formatPath(nextWorkspace));
      return true;
    }
    case "new":
      await runtime.newSession(scope, currentWorkspace);
      await thread.post("已创建新会话。后续消息会使用新的 Pi session。");
      return true;
    case "session": {
      if (!parsed.args) {
        const sessions = await runtime.listSessions(scope, currentWorkspace);
        if (sessions.length === 0) {
          await thread.post("当前还没有可切换的 session。\n直接发送消息即可创建新的 Pi session。");
          return true;
        }

        const lines = sessions.slice(0, 10).map((session, index) => {
          const title = session.name || session.firstMessage || "(empty)";
          return `${index + 1}. ${title.slice(0, 60)}\n${session.path}`;
        });
        await thread.post(
          `最近的 session：\n\n${lines.join("\n\n")}\n\n使用 /session switch <编号> 切换。`,
        );
        return true;
      }

      const match = parsed.args.match(/^switch\s+(\d+)$/i);
      if (!match) {
        await thread.post("用法：/session 或 /session switch <编号>");
        return true;
      }

      const sessions = await runtime.listSessions(scope, currentWorkspace);
      const index = Number.parseInt(match[1], 10) - 1;
      const target = sessions[index];
      if (!target) {
        await thread.post("找不到对应编号的 session。");
        return true;
      }

      const switched = await runtime.switchSession(scope, currentWorkspace, target.path);
      await thread.post(switched ? `已切换到 session：${target.path}` : "session 切换被取消。");
      return true;
    }
    case "status":
      const agent = config.agents[config.telegram.defaultAgent];
      if (!agent) {
        throw new Error(`Default agent is not configured: ${config.telegram.defaultAgent}`);
      }
      await thread.post(
        formatTelegramStatusMessage({
          agentDisplayName: agent.displayName,
          agentId: agent.id,
          piProfile: agent.piProfile,
          profileRoot: agent.profileRoot,
          telegramApiBaseUrl: config.telegram.apiBaseUrl,
          threadId: thread.id,
          workspace: currentWorkspace,
        }),
      );
      return true;
    default:
      return false;
  }
}

/**
 * 5-step prompt pipeline:
 * 1. Rate-limit check per chat.
 * 2. Normalize raw Telegram input (text, voice-to-text, attachment paths, stickers).
 * 3. If the Pi agent is already running, steer the in-flight session instead of starting a new one.
 * 4. Otherwise, snapshot workspace, then prompt a fresh session.
 * 5. After completion, detect any new/changed files and send them back as attachments.
 */
async function handlePrompt(
  thread: Thread,
  message: TelegramInputMessage,
  config: Config,
  runtime: PiRuntime,
): Promise<void> {
  const threadKey = getThreadKeyFromId(thread.id);
  const scope = getDefaultRuntimeScope(config, threadKey);
  if (!hasPotentialTelegramInput(message)) {
    await thread.post("没有识别到可处理的 Telegram 输入。请发送文本、图片、文件、语音或贴纸。");
    return;
  }

  const normalized = await normalizeTelegramInput({
    baseDir: config.paths.baseDir,
    message,
    sttConfig: config.stt,
    threadKey,
  });
  if (!isTelegramInputProcessable(normalized)) {
    await thread.post("没有识别到可处理的 Telegram 输入。请发送文本、图片、文件、语音或贴纸。");
    return;
  }

  const promptText = injectPromptTimestampPrefix(normalized.text);

  if (runtime.isRunning(scope)) {
    // 消息注入到正在运行的 session，最终回复由最初那条 prompt 的 handler 统一发送，
    // 这里必须 return，避免两条 handler 都对同一份输出调用 replyLong 造成重复回复。
    await runtime.steer(scope, promptText, normalized.images);
    return;
  }

  const workspace = await getWorkspace(threadKey, config.paths.workspace);
  // `snapshotWorkspace` must run before `prompt` so `detectFiles` can diff against the pre-run state.
  const beforeSnapshot = await snapshotWorkspace(workspace);
  await thread.startTyping();

  const result = await runtime.prompt(scope, promptText, workspace, {
    images: normalized.images,
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
    try {
      await sendDetectedFile(thread, file);
    } catch {
      await thread.post(`生成文件：${file.filename}\n${file.path}`);
    }
  }
}

export function createBot(
  configSource: ConfigSource,
  runtime = new PiRuntime(configSource),
): BotRuntime {
  const initialConfig = readConfig(configSource);
  configureWorkspaceState(initialConfig.paths.baseDir);
  const telegram = createTelegramAdapter({
    apiBaseUrl: initialConfig.telegram.apiBaseUrl,
    botToken: initialConfig.telegram.botToken,
    secretToken: initialConfig.telegram.webhookSecret,
    mode: "webhook",
  });
  const chat = new Chat({
    userName: "shellRaining_bot",
    concurrency: TELEGRAM_CONCURRENCY,
    adapters: {
      telegram,
    },
    logger: "info",
    state: createMemoryState(),
  });

  chat.onDirectMessage(async (thread, message) => {
    const config = readConfig(configSource);
    if (!isUserAllowed(config.telegram.allowedUsers, message.author.userId)) {
      await thread.post("未授权访问。");
      return;
    }
    await thread.subscribe();
    if (await handleCommand(thread, message.text || "", config, runtime)) {
      return;
    }
    await handlePrompt(thread, message as TelegramInputMessage, config, runtime);
  });

  chat.onNewMention(async (thread, message) => {
    const config = readConfig(configSource);
    if (!isUserAllowed(config.telegram.allowedUsers, message.author.userId)) {
      await thread.post("未授权访问。");
      return;
    }
    await thread.subscribe();
    if (await handleCommand(thread, message.text || "", config, runtime)) {
      return;
    }
    await handlePrompt(thread, message as TelegramInputMessage, config, runtime);
  });

  chat.onSubscribedMessage(async (thread, message) => {
    const config = readConfig(configSource);
    if (!isUserAllowed(config.telegram.allowedUsers, message.author.userId)) {
      await thread.post("未授权访问。");
      return;
    }
    if (await handleCommand(thread, message.text || "", config, runtime)) {
      return;
    }
    await handlePrompt(thread, message as TelegramInputMessage, config, runtime);
  });

  return {
    chat,
    runtime,
    telegram: {
      async postCronMessage(threadId: string, text: string): Promise<void> {
        try {
          await telegram.postMessage(threadId, toTelegramReplyMessage(text));
        } catch (error) {
          if (!shouldFallbackToRawTelegramReply(error)) {
            throw error;
          }
          await telegram.postMessage(threadId, text);
        }
      },
    },
  };
}
