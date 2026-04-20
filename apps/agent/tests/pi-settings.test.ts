import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMkdir = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockCopyFile = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

describe("pi-settings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
  });

  it("creates new settings file when missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const { syncPiSettings } = await import("../src/runtime/pi-settings.js");
    const result = await syncPiSettings({
      agentDir: "/mock/.pi/agent",
      skillsDir: "/skills",
      backupDir: "/backups",
    });

    expect(result.changed).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/mock/.pi/agent/settings.json",
      expect.stringContaining('"skills"'),
    );
  });

  it("merges skills directory without duplicating existing entry", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        defaultModel: "x",
        skills: ["/skills", "/other"],
      }),
    );
    mockStat.mockResolvedValue({ isFile: () => true });

    const { syncPiSettings } = await import("../src/runtime/pi-settings.js");
    const result = await syncPiSettings({
      agentDir: "/mock/.pi/agent",
      skillsDir: "/skills",
      backupDir: "/backups",
    });

    expect(result.changed).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("backs up existing settings before writing changes", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ skills: ["/old"] }));
    mockStat.mockResolvedValue({ isFile: () => true });

    const { syncPiSettings } = await import("../src/runtime/pi-settings.js");
    await syncPiSettings({
      agentDir: "/mock/.pi/agent",
      skillsDir: "/skills",
      backupDir: "/backups",
      timestamp: "2026-04-09T01-00-00Z",
    });

    expect(mockCopyFile).toHaveBeenCalledWith(
      "/mock/.pi/agent/settings.json",
      "/backups/pi-settings-2026-04-09T01-00-00Z.json",
    );
  });
});
