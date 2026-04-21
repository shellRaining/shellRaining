import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn();
const close = vi.fn(async () => undefined);
const on = vi.fn();
const watchedPaths: string[] = [];

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn((paths: string | string[]) => {
      watchedPaths.push(...(Array.isArray(paths) ? paths : [paths]));
      return { add, close, on };
    }),
  },
}));

describe("SkillWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    watchedPaths.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates watched paths", async () => {
    const onReload = vi.fn(async () => undefined);
    const { SkillWatcher } = await import("../src/pi/skill-watcher.js");
    const watcher = new SkillWatcher({
      paths: ["/skills/global"],
      debounceMs: 500,
      onReload,
    });

    await watcher.addPath("/skills/global");
    await watcher.addPath("/skills/project");

    expect(watchedPaths).toEqual(["/skills/global"]);
    expect(add).toHaveBeenCalledWith("/skills/project");
  });

  it("debounces repeated file events into one reload", async () => {
    const handlers = new Map<string, (path: string) => void>();
    on.mockImplementation((event, handler) => {
      handlers.set(event, handler);
      return { add, close, on };
    });
    const onReload = vi.fn(async () => undefined);
    const { SkillWatcher } = await import("../src/pi/skill-watcher.js");
    new SkillWatcher({
      paths: ["/skills/global"],
      debounceMs: 500,
      onReload,
    });

    handlers.get("add")?.("/skills/a/SKILL.md");
    handlers.get("change")?.("/skills/a/SKILL.md");
    handlers.get("unlink")?.("/skills/a/SKILL.md");

    await vi.advanceTimersByTimeAsync(499);
    expect(onReload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("closes the underlying chokidar watcher", async () => {
    const { SkillWatcher } = await import("../src/pi/skill-watcher.js");
    const watcher = new SkillWatcher({
      paths: ["/skills/global"],
      debounceMs: 500,
      onReload: async () => undefined,
    });

    await watcher.dispose();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
