import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn(async () => undefined);
const on = vi.fn();
const watchedPaths: string[] = [];

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn((paths: string | string[]) => {
      watchedPaths.push(...(Array.isArray(paths) ? paths : [paths]));
      return { close, on };
    }),
  },
}));

describe("ProfileWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    watchedPaths.length = 0;
    close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("watches Pi-owned profile inputs", async () => {
    const { ProfileWatcher } = await import("../src/pi/profile-watcher.js");
    new ProfileWatcher({
      debounceMs: 500,
      onAuthOrModelChange: async () => undefined,
      onResourceChange: async () => undefined,
      piProfile: "default",
      profileRoot: "/profiles/default",
    });

    expect(watchedPaths).toEqual([
      "/profiles/default/settings.json",
      "/profiles/default/models.json",
      "/profiles/default/auth.json",
      "/profiles/default/skills",
      "/profiles/default/extensions",
      "/profiles/default/prompts",
      "/profiles/default/themes",
    ]);
  });

  it("watches agent persona files for shared profile resources", async () => {
    const { createNoopLogger } = await import("../src/logging/service.js");
    const { ProfileWatcher } = await import("../src/pi/profile-watcher.js");
    new ProfileWatcher({
      debounceMs: 10,
      logger: createNoopLogger(),
      onAuthOrModelChange: async () => undefined,
      onResourceChange: async () => undefined,
      piProfile: "shared",
      profileRoot: "/base/pi-profiles/shared",
      resourceRoots: ["/base/agents/coder"],
    });

    expect(watchedPaths).toEqual([
      "/base/pi-profiles/shared/settings.json",
      "/base/pi-profiles/shared/models.json",
      "/base/pi-profiles/shared/auth.json",
      "/base/pi-profiles/shared/skills",
      "/base/pi-profiles/shared/extensions",
      "/base/pi-profiles/shared/prompts",
      "/base/pi-profiles/shared/themes",
      "/base/agents/coder/IDENTITY.md",
      "/base/agents/coder/SOUL.md",
      "/base/agents/coder/USER.md",
    ]);
  });

  it("deduplicates watched agent persona resource roots", async () => {
    const { createNoopLogger } = await import("../src/logging/service.js");
    const { ProfileWatcher } = await import("../src/pi/profile-watcher.js");
    new ProfileWatcher({
      debounceMs: 10,
      logger: createNoopLogger(),
      onAuthOrModelChange: async () => undefined,
      onResourceChange: async () => undefined,
      piProfile: "shared",
      profileRoot: "/base/pi-profiles/shared",
      resourceRoots: ["/base/agents/coder", "/base/agents/coder"],
    });

    expect(watchedPaths.filter((path) => path === "/base/agents/coder/IDENTITY.md")).toHaveLength(
      1,
    );
    expect(watchedPaths.filter((path) => path === "/base/agents/coder/SOUL.md")).toHaveLength(1);
    expect(watchedPaths.filter((path) => path === "/base/agents/coder/USER.md")).toHaveLength(1);
  });

  it("debounces resource and auth/model changes separately", async () => {
    const handlers = new Map<string, (path: string) => void>();
    on.mockImplementation((event, handler) => {
      handlers.set(event, handler);
      return { close, on };
    });
    const onResourceChange = vi.fn(async () => undefined);
    const onAuthOrModelChange = vi.fn(async () => undefined);
    const { ProfileWatcher } = await import("../src/pi/profile-watcher.js");
    new ProfileWatcher({
      debounceMs: 500,
      onAuthOrModelChange,
      onResourceChange,
      piProfile: "default",
      profileRoot: "/profiles/default",
    });

    handlers.get("change")?.("/profiles/default/skills/example/SKILL.md");
    handlers.get("change")?.("/profiles/default/prompts/default.md");
    handlers.get("addDir")?.("/profiles/default/themes/new-theme");
    handlers.get("change")?.("/profiles/default/models.json");

    await vi.advanceTimersByTimeAsync(499);
    expect(onResourceChange).not.toHaveBeenCalled();
    expect(onAuthOrModelChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onResourceChange).toHaveBeenCalledTimes(1);
    expect(onResourceChange).toHaveBeenCalledWith("default");
    expect(onAuthOrModelChange).toHaveBeenCalledTimes(1);
    expect(onAuthOrModelChange).toHaveBeenCalledWith("default");
  });

  it("closes the underlying watcher", async () => {
    const { ProfileWatcher } = await import("../src/pi/profile-watcher.js");
    const watcher = new ProfileWatcher({
      debounceMs: 500,
      onAuthOrModelChange: async () => undefined,
      onResourceChange: async () => undefined,
      piProfile: "default",
      profileRoot: "/profiles/default",
    });

    await watcher.dispose();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
