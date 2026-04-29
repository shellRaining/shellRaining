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
const skillWatcherAddPath = vi.fn(async () => undefined);
const skillWatcherDispose = vi.fn(async () => undefined);
const skillWatcherCtor = vi.fn(function SkillWatcherMock() {
  return {
    addPath: skillWatcherAddPath,
    dispose: skillWatcherDispose,
  };
});
const loadSkills = vi.fn(() => ({
  diagnostics: [],
  skills: [
    {
      baseDir: "/mock/skills/example",
      description: "Example skill",
      disableModelInvocation: false,
      filePath: "/mock/skills/example/SKILL.md",
      name: "example",
      sourceInfo: { source: "test" },
    },
  ],
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
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
  loadSkills,
  SessionManager: {
    continueRecent: sessionManagerContinueRecent,
    create: sessionManagerCreate,
    list: vi.fn(() => []),
  },
}));

vi.mock("../src/pi/skill-watcher.js", () => ({
  SkillWatcher: skillWatcherCtor,
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
    sessionGetActiveToolNames.mockReturnValue(["read", "bash"]);
    sessionSetActiveToolsByName.mockReturnValue(undefined);
    skillWatcherAddPath.mockResolvedValue(undefined);
    skillWatcherDispose.mockResolvedValue(undefined);
    loadSkills.mockReturnValue({
      diagnostics: [],
      skills: [
        {
          baseDir: "/mock/skills/example",
          description: "Example skill",
          disableModelInvocation: false,
          filePath: "/mock/skills/example/SKILL.md",
          name: "example",
          sourceInfo: { source: "test" },
        },
      ],
    });
    skillWatcherCtor.mockImplementation(function SkillWatcherMock() {
      return {
        addPath: skillWatcherAddPath,
        dispose: skillWatcherDispose,
      };
    });
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

  it("loads only configured shellRaining skills through the Pi resource loader", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");

    expect(loadSkills).toHaveBeenCalledWith({
      includeDefaults: false,
      skillPaths: ["/mock/skills"],
    });

    const options = defaultResourceLoader.mock.calls.at(0)?.at(0) as unknown as {
      noSkills?: boolean;
      skillsOverride?: (base: { diagnostics: unknown[]; skills: unknown[] }) => {
        diagnostics: unknown[];
        skills: unknown[];
      };
    };

    expect(options.noSkills).toBe(true);
    expect(options.skillsOverride?.({ diagnostics: [], skills: [] })).toEqual({
      diagnostics: [],
      skills: [
        {
          baseDir: "/mock/skills/example",
          description: "Example skill",
          disableModelInvocation: false,
          filePath: "/mock/skills/example/SKILL.md",
          name: "example",
          sourceInfo: { source: "test" },
        },
      ],
    });
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

  it("watches only the configured shellRaining skills directory", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");

    expect(skillWatcherCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        paths: ["/mock/skills"],
        debounceMs: 500,
      }),
    );
  });

  it("reloads the resource loader and rebuilds the system prompt after skill changes", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");

    const options = skillWatcherCtor.mock.calls.at(0)?.at(0) as unknown as {
      onReload: () => Promise<void>;
    };
    await options.onReload();

    expect(resourceLoaderReload).toHaveBeenCalledTimes(2);
    expect(sessionGetActiveToolNames).toHaveBeenCalledTimes(1);
    expect(sessionSetActiveToolsByName).toHaveBeenCalledWith(["read", "bash"]);
  });

  it("disposes sessions and the skill watcher", async () => {
    const { PiRuntime } = await import("../src/pi/runtime.js");
    const runtime = new PiRuntime(createRuntimeConfig());

    await runtime.prompt("telegram__1", "hello", "/mock/workspace");
    await runtime.dispose();

    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(skillWatcherDispose).toHaveBeenCalledTimes(1);
  });
});
