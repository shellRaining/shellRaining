import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAccess = vi.fn();
const mockMkdir = vi.fn();
const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockWriteFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock/home",
}));

describe("workspace", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("returns home directory when no state exists", async () => {
    const { getWorkspace } = await import("../src/runtime/workspace.js");
    const result = await getWorkspace("thread-123");
    expect(result).toBe("/mock/home");
  });

  it("returns stored workspace when it exists", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ "thread-123": "/stored/path" }));
    mockStat.mockResolvedValue({ isDirectory: () => true });

    const { getWorkspace } = await import("../src/runtime/workspace.js");
    const result = await getWorkspace("thread-123");
    expect(result).toBe("/stored/path");
  });

  it("expands home and persists workspace changes", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ isDirectory: () => true });

    const { setWorkspace } = await import("../src/runtime/workspace.js");
    const result = await setWorkspace("thread-123", "~/projects");
    expect(result).toBe("/mock/home/projects");
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/mock/home/.shell-raining/state/workspaces.json",
      expect.stringContaining("/mock/home/projects"),
    );
  });

  it("formats home-relative paths", async () => {
    const { formatPath } = await import("../src/runtime/workspace.js");
    expect(formatPath("/mock/home/projects/myapp")).toBe("~/projects/myapp");
  });
});
