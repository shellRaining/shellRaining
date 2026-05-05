import { beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config/index.js";

type SessionListener = (event: unknown) => void;

const sessionPrompt = vi.fn();
const sessionSubscribe = vi.fn((_listener: SessionListener) => () => undefined);
const sessionDispose = vi.fn();
const sessionNewSession = vi.fn();
const sessionSteer = vi.fn();
const sessionGetActiveToolNames = vi.fn(() => ["read", "bash"]);
const sessionSetActiveToolsByName = vi.fn();
const sessionManagerContinueRecent = vi.fn(() => ({ mode: "recent" }));
const sessionManagerCreate = vi.fn(() => ({ mode: "new" }));
const resourceLoaderReloads: ReturnType<typeof vi.fn>[] = [];
const resourceLoaderOptions: unknown[] = [];
const defaultResourceLoader = vi.fn(function DefaultResourceLoaderMock(options: unknown) {
  const reload = vi.fn(async () => undefined);
  resourceLoaderReloads.push(reload);
  resourceLoaderOptions.push(options);
  return {
    reload,
  };
});
const registerProvider = vi.fn();
const authStorageCreate = vi.fn(() => ({ kind: "auth" }));
const modelRegistryCtor = vi.fn(function ModelRegistryMock() {
  return { kind: "models", registerProvider };
});
const settingsManagerCreate = vi.fn(() => ({ kind: "settings" }));
const fsAccess = vi.hoisted(() => vi.fn(async (_path: unknown) => undefined));
const watcherClose = vi.fn(async () => undefined);
const watcherOn = vi.fn();
const watchedPaths: string[] = [];

vi.mock("node:fs/promises", async () => ({
  ...(await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")),
  access: fsAccess,
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
      steer: sessionSteer,
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

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn((paths: string | string[]) => {
      watchedPaths.push(...(Array.isArray(paths) ? paths : [paths]));
      return { close: watcherClose, on: watcherOn };
    }),
  },
}));

function createRuntimeConfig(overrides: Partial<Config> = {}) {
  const config: Config = {
    agents: {
      coder: {
        aliases: [],
        displayName: "Coder",
        id: "coder",
        personaRoot: "/mock/base/agents/coder",
        piProfile: "coder-profile",
        profileRoot: "/mock/coder-agent",
      },
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

  return {
    ...config,
    ...overrides,
  };
}

describe("PiRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionPrompt.mockResolvedValue(undefined);
    sessionSteer.mockResolvedValue(undefined);
    sessionSubscribe.mockReturnValue(() => undefined);
    sessionNewSession.mockResolvedValue(true);
    sessionManagerContinueRecent.mockReturnValue({ mode: "recent" });
    sessionManagerCreate.mockReturnValue({ mode: "new" });
    resourceLoaderReloads.length = 0;
    resourceLoaderOptions.length = 0;
    sessionGetActiveToolNames.mockReturnValue(["read", "bash"]);
    sessionSetActiveToolsByName.mockReturnValue(undefined);
    authStorageCreate.mockReturnValue({ kind: "auth" });
    modelRegistryCtor.mockImplementation(function ModelRegistryMock() {
      return { kind: "models", registerProvider };
    });
    settingsManagerCreate.mockReturnValue({ kind: "settings" });
    registerProvider.mockReturnValue(undefined);
    fsAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    watchedPaths.length = 0;
  });

  it("scopes Pi sessions by agent id and thread key", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    await runtime.prompt(
      { agentId: "coder", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );

    expect(authStorageCreate).toHaveBeenNthCalledWith(1, "/mock/agent/auth.json");
    expect(authStorageCreate).toHaveBeenNthCalledWith(2, "/mock/coder-agent/auth.json");
    expect(sessionManagerContinueRecent).toHaveBeenNthCalledWith(
      1,
      "/mock/workspace",
      "/mock/base/sessions/default/telegram__1",
    );
    expect(sessionManagerContinueRecent).toHaveBeenNthCalledWith(
      2,
      "/mock/workspace",
      "/mock/base/sessions/coder/telegram__1",
    );
  });

  it("rejects unknown agent scopes before creating session directories", async () => {
    const { mkdir } = await import("node:fs/promises");
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await expect(
      runtime.prompt({ agentId: "missing", threadKey: "telegram__1" }, "hello", "/mock/workspace"),
    ).rejects.toThrow("Agent is not configured: missing");

    expect(mkdir).not.toHaveBeenCalled();
  });

  it("continues legacy default-agent session directories when no scoped directory exists", async () => {
    fsAccess.mockImplementation(async (path: unknown) => {
      if (path === "/mock/base/sessions/telegram__1") {
        return undefined;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );

    expect(sessionManagerContinueRecent).toHaveBeenCalledWith(
      "/mock/workspace",
      "/mock/base/sessions/telegram__1",
    );
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

  it("reloads active sessions for changed Pi profile resources", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    await runtime.prompt(
      { agentId: "coder", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    resourceLoaderReloads.forEach((reload) => reload.mockClear());

    await runtime.reloadProfileResources("default");

    expect(sessionGetActiveToolNames).toHaveBeenCalledBefore(resourceLoaderReloads[0]);
    expect(resourceLoaderReloads[0]).toHaveBeenCalledTimes(1);
    expect(resourceLoaderReloads[1]).not.toHaveBeenCalled();
    expect(sessionSetActiveToolsByName).toHaveBeenCalledTimes(1);
    expect(sessionSetActiveToolsByName).toHaveBeenCalledWith(["read", "bash"]);
  });

  it("recreates sessions for changed Pi profile registries on the next prompt", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    await runtime.prompt(
      { agentId: "coder", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );

    await runtime.invalidateProfileSessions("default");
    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "again",
      "/mock/workspace",
    );

    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(defaultResourceLoader).toHaveBeenCalledTimes(3);
    expect(authStorageCreate).toHaveBeenNthCalledWith(3, "/mock/agent/auth.json");
  });

  it("defers profile session invalidation while a prompt is in flight", async () => {
    let resolvePrompt: (() => void) | undefined;
    sessionPrompt.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    const prompt = runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    await vi.waitFor(() => expect(sessionPrompt).toHaveBeenCalledTimes(1));
    await runtime.invalidateProfileSessions("default");

    expect(sessionDispose).not.toHaveBeenCalled();

    resolvePrompt?.();
    await prompt;
    sessionPrompt.mockResolvedValue(undefined);
    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "again",
      "/mock/workspace",
    );

    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(defaultResourceLoader).toHaveBeenCalledTimes(2);
  });

  it("queues steer while an inflight prompt is still creating its session", async () => {
    let resolveCreateSession: (() => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    sessionPrompt.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    vi.mocked(createAgentSession).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreateSession = () => {
            resolve({
              session: {
                dispose: sessionDispose,
                getActiveToolNames: sessionGetActiveToolNames,
                newSession: sessionNewSession,
                prompt: sessionPrompt,
                setActiveToolsByName: sessionSetActiveToolsByName,
                subscribe: sessionSubscribe,
                steer: sessionSteer,
                switchSession: vi.fn(),
              },
            } as unknown as Awaited<ReturnType<typeof createAgentSession>>);
          };
        }),
    );
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    const prompt = runtime.prompt("telegram__1", "hello", "/mock/workspace");
    await vi.waitFor(() => expect(runtime.isRunning("telegram__1")).toBe(true));
    await vi.waitFor(() => expect(createAgentSession).toHaveBeenCalledTimes(1));

    const steer = runtime.steer("telegram__1", "follow up");
    await Promise.resolve();

    expect(sessionSteer).not.toHaveBeenCalled();

    resolveCreateSession?.();
    await vi.waitFor(() => expect(sessionSteer).toHaveBeenCalledWith("follow up", undefined));
    resolvePrompt?.();

    await steer;
    await prompt;
  });

  it("starts one profile watcher for each used Pi profile", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    await runtime.prompt(
      { agentId: "default", threadKey: "telegram__2" },
      "hello",
      "/mock/workspace",
    );
    await runtime.prompt(
      { agentId: "coder", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );

    expect(watchedPaths).toEqual([
      "/mock/agent/settings.json",
      "/mock/agent/models.json",
      "/mock/agent/auth.json",
      "/mock/agent/skills",
      "/mock/agent/extensions",
      "/mock/agent/prompts",
      "/mock/agent/themes",
      "/mock/base/agents",
      "/mock/base/agents/default",
      "/mock/base/agents/default/IDENTITY.md",
      "/mock/base/agents/default/SOUL.md",
      "/mock/base/agents/default/USER.md",
      "/mock/coder-agent/settings.json",
      "/mock/coder-agent/models.json",
      "/mock/coder-agent/auth.json",
      "/mock/coder-agent/skills",
      "/mock/coder-agent/extensions",
      "/mock/coder-agent/prompts",
      "/mock/coder-agent/themes",
      "/mock/base/agents",
      "/mock/base/agents/coder",
      "/mock/base/agents/coder/IDENTITY.md",
      "/mock/base/agents/coder/SOUL.md",
      "/mock/base/agents/coder/USER.md",
    ]);
  });

  it("watches shared-profile agent persona files without recreating sessions on resource reload", async () => {
    const tempDir = join(tmpdir(), "pi-runtime-shared-persona");
    const personaRoot = join(tempDir, "agents", "coder");
    const config = createRuntimeConfig({
      agents: {
        ...createRuntimeConfig().agents,
        coder: {
          ...createRuntimeConfig().agents.coder,
          personaRoot,
          piProfile: "shared",
          profileRoot: join(tempDir, "pi-profiles", "shared"),
        },
      },
    });
    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(config);

    await runtime.prompt(
      { agentId: "coder", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    await runtime.reloadProfileResources("shared");

    expect(watchedPaths).toContain(join(personaRoot, "IDENTITY.md"));
    expect(watchedPaths).toContain(join(personaRoot, ".."));
    expect(watchedPaths).toContain(join(personaRoot, "SOUL.md"));
    expect(watchedPaths).toContain(join(personaRoot, "USER.md"));
    expect(resourceLoaderReloads[0]).toHaveBeenCalledTimes(2);
    expect(createAgentSession).toHaveBeenCalledTimes(1);
  });

  it("refreshes shared-profile persona prompt without recreating sessions", async () => {
    const { mkdir, mkdtemp, writeFile } =
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-shared-persona-reload-"));
    const personaRoot = join(tempDir, "agents", "coder");
    await mkdir(personaRoot, { recursive: true });
    await writeFile(join(personaRoot, "SOUL.md"), "old persona");
    const config = createRuntimeConfig({
      agents: {
        ...createRuntimeConfig().agents,
        coder: {
          ...createRuntimeConfig().agents.coder,
          personaRoot,
          piProfile: "shared",
          profileRoot: join(tempDir, "pi-profiles", "shared"),
        },
      },
    });
    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(config);

    await runtime.prompt(
      { agentId: "coder", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );
    await writeFile(join(personaRoot, "SOUL.md"), "new persona");
    await runtime.reloadProfileResources("shared");

    const options = resourceLoaderOptions[0] as {
      appendSystemPromptOverride?: (base: string[]) => string[];
    };
    const prompt = options.appendSystemPromptOverride?.(["base prompt"]).join("\n") ?? "";
    expect(prompt).toContain("new persona");
    expect(prompt).not.toContain("old persona");
    expect(resourceLoaderReloads[0]).toHaveBeenCalledTimes(2);
    expect(createAgentSession).toHaveBeenCalledTimes(1);
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
    expect(result?.at(-1)).toContain("~/.shellRaining/inbox/");
    expect(result?.at(-1)).not.toContain("Pi may append an <available_skills> catalog later");
  });

  it("appends agent persona files to the shellRaining system prompt", async () => {
    const { mkdir, mkdtemp, writeFile } =
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-"));
    const personaRoot = join(tempDir, "agents", "coder");
    await mkdir(personaRoot, { recursive: true });
    await writeFile(join(personaRoot, "SOUL.md"), "Speak like a pragmatic coding partner.");
    const config = createRuntimeConfig({
      agents: {
        ...createRuntimeConfig().agents,
        coder: {
          ...createRuntimeConfig().agents.coder,
          personaRoot,
          profileRoot: join(tempDir, "pi-profiles", "shared"),
        },
      },
      telegram: {
        ...createRuntimeConfig().telegram,
        defaultAgent: "coder",
      },
    });
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(config);

    await runtime.prompt(
      { agentId: "coder", threadKey: "telegram__1" },
      "hello",
      "/mock/workspace",
    );

    const options = defaultResourceLoader.mock.calls.at(0)?.at(0) as unknown as {
      appendSystemPromptOverride?: (base: string[]) => string[];
    };
    const result = options.appendSystemPromptOverride?.(["base prompt"]);
    const prompt = result?.join("\n") ?? "";
    const personaIndex = prompt.indexOf("Speak like a pragmatic coding partner.");
    const telegramOutputIndex = prompt.indexOf("Telegram output is a chat surface");

    expect(prompt).toContain("# Agent Persona Context");
    expect(prompt).toContain("## SOUL.md");
    expect(personaIndex).toBeGreaterThan(-1);
    expect(telegramOutputIndex).toBeGreaterThan(-1);
    expect(personaIndex).toBeLessThan(telegramOutputIndex);
  });

  it("captures showThinking from the config source at prompt start", async () => {
    let currentConfig = createRuntimeConfig();
    sessionSubscribe.mockImplementation((listener: SessionListener) => {
      sessionPrompt.mockImplementation(async () => {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_delta", delta: "thought" },
        });
      });
      return () => undefined;
    });
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(() => currentConfig);

    let result = await runtime.prompt("telegram__1", "hello", "/mock/workspace");
    expect(result.text).toBe("(no output)");

    await runtime.newSession("telegram__1", "/mock/workspace");
    currentConfig = {
      ...createRuntimeConfig(),
      telegram: { ...createRuntimeConfig().telegram, showThinking: true },
    };

    result = await runtime.prompt("telegram__1", "hello", "/mock/workspace");
    expect(result.text).toBe("thought");
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
      "/mock/base/sessions/default/telegram__1",
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
    expect(watcherClose).toHaveBeenCalledTimes(1);
  });
});
