import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimePrompt = vi.fn<(...args: any[]) => Promise<{ text: string }>>(async () => ({
  text: "done",
}));
const isRunning = vi.fn(() => false);
const steer = vi.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const startTyping = vi.fn(async () => undefined);
const post = vi.fn(async () => undefined);
const subscribe = vi.fn(async () => undefined);
const detectFiles = vi.fn(async () => []);
const snapshotWorkspace = vi.fn(async () => ({ entries: [] }));
const normalizeTelegramInput = vi.fn(async () => ({
  images: [],
  isProcessable: true,
  savedFiles: [],
  text: "帮我总结今天做过的事情",
  warnings: [],
}));

let onDirectMessageHandler:
  | ((
      thread: {
        id: string;
        post: typeof post;
        startTyping: typeof startTyping;
        subscribe: typeof subscribe;
      },
      message: any,
    ) => Promise<void>)
  | undefined;

vi.mock("@chat-adapter/telegram", () => ({
  createTelegramAdapter: vi.fn(() => ({ postMessage: vi.fn() })),
}));

vi.mock("@chat-adapter/state-memory", () => ({
  createMemoryState: vi.fn(() => ({})),
}));

vi.mock("chat", () => ({
  Chat: class Chat {
    public readonly webhooks = {
      telegram: vi.fn(async () => new Response(null, { status: 200 })),
    };

    onDirectMessage(handler: typeof onDirectMessageHandler): void {
      onDirectMessageHandler = handler;
    }

    onNewMention(): void {}
    onSubscribedMessage(): void {}
  },
}));

vi.mock("../src/runtime/telegram-input.js", () => ({
  isTelegramInputMessage: vi.fn(() => true),
  normalizeTelegramInput,
}));

vi.mock("../src/runtime/artifact-detector.js", () => ({
  detectFiles,
  snapshotWorkspace,
}));

vi.mock("../src/runtime/workspace.js", () => ({
  configureWorkspaceState: vi.fn(),
  formatPath: vi.fn((value: string) => value),
  getWorkspace: vi.fn(async () => "/mock/workspace"),
  setWorkspace: vi.fn(async () => "/mock/workspace"),
}));

function createConfig() {
  return {
    agents: {
      default: {
        aliases: [],
        displayName: "shellRaining",
        id: "default",
        piProfile: "default",
        profileRoot: "/mock/agent",
      },
    },
    cron: {
      jobsPath: "/mock/base/cron/jobs.json",
      misfireGraceMs: 5 * 60 * 1000,
      runTimeoutMs: 5 * 60 * 1000,
    },
    logging: {
      file: {
        enabled: true,
        frequency: "daily" as const,
        limit: {
          count: 10,
        },
        mkdir: true,
        path: "/mock/base/logs/shellraining.log",
      },
      level: "info" as const,
    },
    paths: {
      baseDir: "/mock/base",
      workspace: "/mock/workspace",
    },
    server: {
      port: 1234,
    },
    stt: {},
    telegram: {
      allowedUsers: [1],
      botToken: "token",
      defaultAgent: "default",
      showThinking: false,
    },
  };
}

function createRuntime() {
  return {
    isRunning,
    listSessions: vi.fn(async () => []),
    newSession: vi.fn(async () => undefined),
    prompt: runtimePrompt,
    steer,
    switchSession: vi.fn(async () => true),
  };
}

describe("bot time awareness", () => {
  beforeEach(() => {
    onDirectMessageHandler = undefined;
    runtimePrompt.mockClear();
    steer.mockClear();
    isRunning.mockReset();
    isRunning.mockReturnValue(false);
    startTyping.mockClear();
    post.mockClear();
    subscribe.mockClear();
    detectFiles.mockClear();
    snapshotWorkspace.mockClear();
    normalizeTelegramInput.mockReset();
    normalizeTelegramInput.mockResolvedValue({
      images: [],
      isProcessable: true,
      savedFiles: [],
      text: "帮我总结今天做过的事情",
      warnings: [],
    });
  });

  it("prefixes direct telegram prompts with a weekday timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T09:00:00.000Z"));

    const { createBot } = await import("../src/bot.js");
    const bot = createBot(createConfig(), createRuntime() as never);
    void bot;

    const thread = {
      id: "telegram:1",
      post,
      startTyping,
      subscribe,
    };
    const message = {
      author: { userId: 1 },
      id: "m1",
      text: "帮我总结今天做过的事情",
    };

    await onDirectMessageHandler?.(thread, message);

    expect(runtimePrompt).toHaveBeenCalledTimes(1);
    expect(runtimePrompt.mock.calls[0]?.[0]).toEqual({
      agentId: "default",
      threadKey: "telegram__1",
    });
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("帮我总结今天做过的事情");
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("[Thu 2026-04-16 09:00 UTC]");

    vi.useRealTimers();
  });

  it("prefixes steer messages with the same weekday timestamp format", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T09:00:00.000Z"));
    isRunning.mockReturnValue(true);
    normalizeTelegramInput.mockResolvedValue({
      images: [],
      isProcessable: true,
      savedFiles: [],
      text: "继续刚才那个任务",
      warnings: [],
    });

    const { createBot } = await import("../src/bot.js");
    const bot = createBot(createConfig(), createRuntime() as never);
    void bot;

    const thread = {
      id: "telegram:1",
      post,
      startTyping,
      subscribe,
    };
    const message = {
      author: { userId: 1 },
      id: "m2",
      text: "继续刚才那个任务",
    };

    await onDirectMessageHandler?.(thread, message);

    expect(steer).toHaveBeenCalledTimes(1);
    expect(steer.mock.calls[0]?.[0]).toEqual({ agentId: "default", threadKey: "telegram__1" });
    expect(steer.mock.calls[0]?.[1]).toContain("继续刚才那个任务");
    expect(steer.mock.calls[0]?.[1]).toContain("[Thu 2026-04-16 09:00 UTC]");

    vi.useRealTimers();
  });

  it("still injects a timestamp prefix when the user only mentions Current time text", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T09:00:00.000Z"));
    normalizeTelegramInput.mockResolvedValue({
      images: [],
      isProcessable: true,
      savedFiles: [],
      text: "请把提示词里的 Current time: 改成 Now:",
      warnings: [],
    });

    const { createBot } = await import("../src/bot.js");
    const bot = createBot(createConfig(), createRuntime() as never);
    void bot;

    const thread = {
      id: "telegram:1",
      post,
      startTyping,
      subscribe,
    };
    const message = {
      author: { userId: 1 },
      id: "m3",
      text: "请把提示词里的 Current time: 改成 Now:",
    };

    await onDirectMessageHandler?.(thread, message);

    expect(runtimePrompt).toHaveBeenCalledTimes(1);
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("[Thu 2026-04-16 09:00 UTC]");
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("请把提示词里的 Current time: 改成 Now:");

    vi.useRealTimers();
  });
});
