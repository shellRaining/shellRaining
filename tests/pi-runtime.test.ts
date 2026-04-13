import { describe, expect, it, vi } from "vitest";

const sessionPrompt = vi.fn();
const sessionSubscribe = vi.fn(() => () => undefined);
const sessionDispose = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn(async () => ({
    session: {
      dispose: sessionDispose,
      listSessions: vi.fn(),
      newSession: vi.fn(),
      prompt: sessionPrompt,
      subscribe: sessionSubscribe,
      switchSession: vi.fn(),
    },
  })),
  DefaultResourceLoader: class {
    reload = vi.fn();
  },
  SessionManager: {
    continueRecent: vi.fn(() => ({})),
    list: vi.fn(() => []),
  },
}));

describe("PiRuntime", () => {
  it("passes image inputs to the Pi session prompt", async () => {
    sessionPrompt.mockResolvedValue(undefined);
    const { PiRuntime } = await import("../src/pi/runtime.js");

    const runtime = new PiRuntime({
      agentDir: "/mock/agent",
      allowedUsers: [],
      baseDir: "/mock/base",
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
    });

    await runtime.prompt("telegram__1", "describe this", "/mock/workspace", {
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });

    expect(sessionPrompt).toHaveBeenCalledWith("describe this", {
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
  });
});
