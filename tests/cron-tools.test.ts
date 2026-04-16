import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CronJob } from "../src/cron/types.js";

function createJob(overrides: Partial<CronJob> = {}): CronJob {
  const base: CronJob = {
    id: "job_123",
    name: "新闻总结",
    chatId: 1,
    threadId: "telegram:1",
    threadKey: "telegram__1",
    enabled: true,
    deleteAfterRun: false,
    createdAtMs: Date.parse("2026-04-16T09:00:00.000Z"),
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { kind: "agentTurn", message: "总结新闻" },
    state: { consecutiveErrors: 0, nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z") },
  };

  return {
    ...base,
    ...overrides,
    payload: {
      ...base.payload,
      ...overrides.payload,
    },
    schedule: overrides.schedule ?? base.schedule,
    state: {
      ...base.state,
      ...overrides.state,
    },
  };
}

function createExtensionApi(registerTool: ReturnType<typeof vi.fn>): ExtensionAPI {
  return { registerTool } as unknown as ExtensionAPI;
}

function getRegisteredTool(registerTool: ReturnType<typeof vi.fn>, name: string) {
  const call = registerTool.mock.calls.find(([tool]) => tool.name === name);
  return call?.[0];
}

describe("buildCronExtensionFactory", () => {
  it("creates jobs through cron_create", async () => {
    const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
    const service = {
      add: vi.fn(async (job: CronJob) => job),
      listJobs: vi.fn(async () => []),
      remove: vi.fn(async () => false),
    };
    const registerTool = vi.fn();

    await buildCronExtensionFactory(service as any)(createExtensionApi(registerTool));

    const tool = getRegisteredTool(registerTool, "cron_create");
    const result = await tool.execute("tool_1", {
      name: "新闻总结",
      chatId: 1,
      threadId: "telegram:1",
      threadKey: "telegram__1",
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { kind: "agentTurn", message: "总结新闻" },
    });

    expect(service.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "新闻总结",
        chatId: 1,
        threadId: "telegram:1",
        threadKey: "telegram__1",
        payload: { kind: "agentTurn", message: "总结新闻" },
      }),
    );
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("已创建定时任务：新闻总结");
  });

  it("lists jobs filtered by chat id", async () => {
    const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
    const service = {
      add: vi.fn(),
      listJobs: vi.fn(async () => [
        createJob({ id: "job_chat_1", chatId: 1, name: "新闻总结" }),
        createJob({ id: "job_chat_2", chatId: 2, name: "别的聊天" }),
      ]),
      remove: vi.fn(),
    };
    const registerTool = vi.fn();

    await buildCronExtensionFactory(service as any)(createExtensionApi(registerTool));

    const tool = getRegisteredTool(registerTool, "cron_list");
    const result = await tool.execute("tool_2", { chatId: 1 });

    expect(service.listJobs).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("新闻总结（job_chat_1）");
    expect(result.content[0]?.text).not.toContain("别的聊天");
  });

  it("removes jobs through cron_remove", async () => {
    const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
    const service = {
      add: vi.fn(),
      listJobs: vi.fn(async () => []),
      remove: vi.fn(async () => true),
    };
    const registerTool = vi.fn();

    await buildCronExtensionFactory(service as any)(createExtensionApi(registerTool));

    const tool = getRegisteredTool(registerTool, "cron_remove");
    const result = await tool.execute("tool_3", { id: "job_123" });

    expect(service.remove).toHaveBeenCalledWith("job_123");
    expect(result.content[0]?.text).toBe("已删除定时任务：job_123");
  });
});
