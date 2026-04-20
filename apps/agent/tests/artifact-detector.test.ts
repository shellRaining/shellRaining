import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReaddir = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

const { parseOutputForFiles, categorizeFiles, detectNewFiles, snapshotWorkspace, detectFiles } =
  await import("../src/runtime/artifact-detector.js");

describe("artifact-detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects generated files from output", () => {
    const output = "Created: /path/to/file.pdf";
    const files = parseOutputForFiles(output);
    expect(files).toContain("/path/to/file.pdf");
  });

  it("categorizes supported files", () => {
    const result = categorizeFiles(["/path/image.png", "/path/doc.pdf"]);
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe("photo");
    expect(result[1]?.type).toBe("document");
  });

  it("snapshots workspace files", async () => {
    mockReaddir.mockResolvedValue([{ name: "file1.txt", isFile: () => true }]);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const snapshot = await snapshotWorkspace("/workspace");
    expect(snapshot.has("/workspace/file1.txt")).toBe(true);
  });

  it("detects new files from workspace changes", async () => {
    mockReaddir.mockResolvedValue([{ name: "newfile.pdf", isFile: () => true }]);
    mockStat.mockResolvedValue({ mtimeMs: 2000 });

    const newFiles = await detectNewFiles("/workspace", new Map());
    expect(newFiles).toContain("/workspace/newfile.pdf");
  });

  it("combines parsed files and workspace changes", async () => {
    mockReaddir.mockResolvedValue([{ name: "new-from-workspace.png", isFile: () => true }]);
    mockStat.mockResolvedValue({ mtimeMs: 2000 });

    const files = await detectFiles("Created: /other/path/file.pdf", "/workspace", new Map());
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});
