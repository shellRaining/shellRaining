import { describe, expect, it } from "vitest";

describe("config path helpers", () => {
  it("centralizes shellRaining default paths", async () => {
    const {
      DEFAULT_BASE_DIR,
      DEFAULT_WORKSPACE,
      resolveDefaultBaseDir,
      resolveDefaultWorkspace,
    } = await import("../src/config/path.js");

    expect(DEFAULT_BASE_DIR).toBe("~/.shellRaining");
    expect(DEFAULT_WORKSPACE).toBe("shellRaining-workspace");
    expect(resolveDefaultBaseDir("/mock/home")).toBe("/mock/home/.shellRaining");
    expect(resolveDefaultWorkspace("/mock/home/.shellRaining")).toBe(
      "/mock/home/.shellRaining/shellRaining-workspace",
    );
  });

  it("derives shellRaining-owned storage paths from baseDir", async () => {
    const {
      getCronJobsPath,
      getProfileRoot,
      getTelegramInboxDisplayPath,
      getTelegramInboxPath,
      getSessionDirectoryForScope,
      getSessionDirectoryForThread,
      getWorkspaceStatePath,
    } = await import("../src/config/path.js");

    expect(getWorkspaceStatePath("/base")).toBe("/base/state/workspaces.json");
    expect(getCronJobsPath("/base")).toBe("/base/cron/jobs.json");
    expect(getTelegramInboxPath("/base", "telegram__1", "message_1")).toBe(
      "/base/inbox/telegram__1/message_1",
    );
    expect(getTelegramInboxDisplayPath()).toBe("~/.shellRaining/inbox/");
    expect(getProfileRoot("/base", "coder")).toBe("/base/pi-profiles/coder");
    expect(getSessionDirectoryForThread("/base", "telegram__1")).toBe(
      "/base/sessions/telegram__1",
    );
    expect(
      getSessionDirectoryForScope("/base", { agentId: "coder", threadKey: "telegram__1" }),
    ).toBe("/base/sessions/coder/telegram__1");
  });
});
