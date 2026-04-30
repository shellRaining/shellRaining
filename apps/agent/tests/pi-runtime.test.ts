import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionListener = (event: unknown) => void;

const sessionPrompt = vi.fn();
const sessionSubscribe = vi.fn((_listener: SessionListener) => () => undefined);
const sessionDispose = vi.fn();
const sessionNewSession = vi.fn();
const sessionGetActiveToolNames = vi.fn(() => ["read", "bash"]);
const sessionSetActiveToolsByName = vi.fn();
const sessionManagerContinueRecent = vi.fn(() => ({ mode: "recent" }));
const sessionManagerCreate = vi.fn(() => ({ mode: "new" }));
const resourceLoaderReload = vi.fn(async () => undefined);
const defaultResourceLoader = vi.fn(function DefaultResourceLoaderMock() {
  return {
    reload: resourceLoaderReload,
  };
});
const registerProvider = vi.fn();
const authStorageCreate = vi.fn(() => ({ kind: "auth" }));
const modelRegistryCtor = vi.fn(function ModelRegistryMock() {
  return { kind: "models", registerProvider };
});
const settingsManagerCreate = vi.fn(() => ({ kind: "settings" }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: { create: authStorageCreate },
  createAgentSession: vi.fn(async () => ({
    session: {
      dispose: sessionDispose,
      getActiveToolNames: sessionGetActiveToolNames,
      listSessions: vi.fn(),
      newSession: sessionNewSession,
      prompt: sessionPrompt,
      setActiveToolsByName: sessionSetActiveToolsByName,
      subscribe: sessionSubscribe,
      switchSession: vi.fn(),
    },
  })),
  DefaultResourceLoader: defaultResourceLoader,
  ModelRegistry: modelRegistryCtor,
  SettingsManager: { create: settingsManagerCreate },
  SessionManager: {
    continueRecent: sessionManagerContinueRecent,
    create: sessionManagerCreate,
    list: vi.fn(() => []),
  },
}));

function createRuntimeConfig() {
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
    allowedUsers: [],
    baseDir: "/mock/base",
    cron: {
      jobsPath: "/mock/base/cron/jobs.json",
      misfireGraceMs: 5 * 60 * 1000,
      runTimeoutMs: 5 * 60 * 1000,
    },
    defaultAgent: "default",
    port: 1234,
    showThinking: false,
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
    sessionGetActiveToolNames.mockReturnValue(["read", "bash"]);
    sessionSetActiveToolsByName.mockReturnValue(undefined);
    authStorageCreate.mockReturnValue({ kind: "auth" });
    modelRegistryCtor.mockImplementation(function ModelRegistryMock() {
      return { kind: "models", registerProvider };
    });
    settingsManagerCreate.mockReturnValue({ kind: "settings" });
    registerProvider.mockReturnValue(undefined);
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

  it("uses the default agent profile root for Pi-owned settings, auth, and models files", async () => {
    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");

    expect(authStorageCreate).toHaveBeenCalledWith("/mock/agent/auth.json");
    expect(modelRegistryCtor).toHaveBeenCalledWith({ kind: "auth" }, "/mock/agent/models.json");
    expect(settingsManagerCreate).toHaveBeenCalledWith("/mock/workspace", "/mock/agent");
    expect(defaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({ settingsManager: { kind: "settings" } }),
    );
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        authStorage: { kind: "auth" },
        modelRegistry: { kind: "models", registerProvider },
        settingsManager: { kind: "settings" },
      }),
    );
  });

  it("appends the shellRaining system prompt through the Pi resource loader", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");

    const options = defaultResourceLoader.mock.calls.at(0)?.at(0) as unknown as {
      appendSystemPromptOverride?: (base: string[]) => string[];
    };
    const result = options.appendSystemPromptOverride?.(["base prompt"]);

    expect(result).toContain("base prompt");
    expect(result?.at(-1)).toContain("Telegram output is a chat surface");
    expect(result?.at(-1)).not.toContain("Pi may append an <available_skills> catalog later");
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

  it("disposes sessions", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");
    await runtime.dispose();

    expect(sessionDispose).toHaveBeenCalledTimes(1);
  });
});
