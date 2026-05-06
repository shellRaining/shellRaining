import { beforeEach, describe, expect, it, vi } from "vitest";

const postMessage = vi.fn(async () => ({ id: "m1", threadId: "telegram:1", raw: {} }));

vi.mock("@chat-adapter/telegram", () => ({
  createTelegramAdapter: vi.fn(() => ({ postMessage })),
}));

vi.mock("@chat-adapter/state-memory", () => ({
  createMemoryState: vi.fn(() => ({})),
}));

vi.mock("chat", () => ({
  Chat: class Chat {
    public readonly webhooks = {
      telegram: vi.fn(async () => new Response(null, { status: 200 })),
    };

    onDirectMessage(): void {}
    onNewMention(): void {}
    onSubscribedMessage(): void {}
  },
}));

vi.mock("../src/pi/runtime.js", () => ({
  PiRuntime: class PiRuntime {},
}));

function createConfig() {
  return {
    agents: {
      default: {
        aliases: [],
        displayName: "shellRaining",
        id: "default",
        personaRoot: "/mock/base/agents/default",
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
    runtime: {},
    server: {
      port: 1234,
    },
    stt: {},
    telegram: {
      allowedUsers: [],
      botToken: "token",
      defaultAgent: "default",
      showThinking: false,
    },
  };
}

describe("bot cron delivery", () => {
  beforeEach(() => {
    postMessage.mockClear();
  });

  it("posts proactive cron messages as telegram markdown by default", async () => {
    const { createBot } = await import("../src/bot.js");
    const bot = createBot(createConfig());

    await bot.telegram.postCronMessage("telegram:1", "done");

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith("telegram:1", { markdown: "done" });
  });

  it("falls back to plain text when telegram rejects markdown entities", async () => {
    postMessage
      .mockRejectedValueOnce(
        Object.assign(new Error("Bad Request: can't parse entities"), { code: "VALIDATION_ERROR" }),
      )
      .mockResolvedValueOnce({ id: "m2", threadId: "telegram:1", raw: {} });

    const { createBot } = await import("../src/bot.js");
    const bot = createBot(createConfig());

    await bot.telegram.postCronMessage("telegram:1", "done");

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(1, "telegram:1", { markdown: "done" });
    expect(postMessage).toHaveBeenNthCalledWith(2, "telegram:1", "done");
  });
});
