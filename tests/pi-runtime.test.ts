import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionListener = (event: unknown) => void;

const sessionPrompt = vi.fn();
const sessionSubscribe = vi.fn((_listener: SessionListener) => () => undefined);
const sessionDispose = vi.fn();
const sessionNewSession = vi.fn();
const sessionManagerContinueRecent = vi.fn(() => ({ mode: "recent" }));
const sessionManagerCreate = vi.fn(() => ({ mode: "new" }));
const resourceLoaderReload = vi.fn(async () => undefined);
const defaultResourceLoader = vi.fn(function DefaultResourceLoaderMock() {
  return {
    reload: resourceLoaderReload,
  };
});

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn(async () => ({
    session: {
      dispose: sessionDispose,
      listSessions: vi.fn(),
      newSession: sessionNewSession,
      prompt: sessionPrompt,
      subscribe: sessionSubscribe,
      switchSession: vi.fn(),
    },
  })),
  DefaultResourceLoader: defaultResourceLoader,
  SessionManager: {
    continueRecent: sessionManagerContinueRecent,
    create: sessionManagerCreate,
    list: vi.fn(() => []),
  },
}));

function createRuntimeConfig() {
  return {
    agentDir: "/mock/agent",
    allowedUsers: [],
    baseDir: "/mock/base",
    cron: {
      jobsPath: "/mock/base/cron/jobs.json",
      misfireGraceMs: 5 * 60 * 1000,
      runTimeoutMs: 5 * 60 * 1000,
    },
    port: 1234,
    rateLimitCooldownMs: 0,
    serviceProfile: {
      apiBaseUrl: "https://api.shellraining.xyz",
      crawlUrl: "https://crawl.shellraining.xyz",
      vikunjaUrl: "https://todo.shellraining.xyz",
    },
    showThinking: false,
    skillsDir: "/mock/skills",
    stt: {},
    telegramToken: "token",
    workspace: "/mock/workspace",
  };
}

describe("PiRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionPrompt.mockResolvedValue(undefined);
    sessionSubscribe.mockReturnValue(() => undefined);
    sessionNewSession.mockResolvedValue(true);
    sessionManagerContinueRecent.mockReturnValue({ mode: "recent" });
    sessionManagerCreate.mockReturnValue({ mode: "new" });
    resourceLoaderReload.mockResolvedValue(undefined);
  });

  it("passes extension factories from builder into the Pi resource loader", async () => {
    const extensionFactory = vi.fn(async () => undefined);
    const builder = vi.fn((_threadKey: string) => [extensionFactory]);
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig(), {
      extensionFactories: builder,
    });

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");

    expect(builder).toHaveBeenCalledWith("telegram__1");
    expect(defaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({ extensionFactories: [extensionFactory] }),
    );
  });

  it("passes image inputs to the Pi session prompt", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");

    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "describe this", "/mock/workspace", {
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });

    expect(sessionPrompt).toHaveBeenCalledWith("describe this", {
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
  });

  it("starts a fresh Pi SDK session manager after starting a new session", async () => {
    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");
    await runtime.newSession("telegram__1", "/mock/workspace");
    await runtime.prompt("telegram__1", "hello again", "/mock/workspace");

    expect(sessionNewSession).not.toHaveBeenCalled();
    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(createAgentSession).toHaveBeenCalledTimes(2);
    expect(sessionManagerContinueRecent).toHaveBeenCalledTimes(1);
    expect(sessionManagerCreate).toHaveBeenCalledWith(
      "/mock/workspace",
      "/mock/base/sessions/telegram__1",
    );
  });

  it("returns assistant message errors emitted by Pi", async () => {
    const errorMessage = "429 已达到 5 小时的使用上限。";
    sessionSubscribe.mockImplementation((listener: SessionListener) => {
      sessionPrompt.mockImplementation(async () => {
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage,
          },
        });
      });
      return () => undefined;
    });
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    const result = await runtime.prompt("telegram__1", "hello", "/mock/workspace");

    expect(result).toEqual({
      artifactsOutput: "",
      error: errorMessage,
      text: "",
    });
  });
});
