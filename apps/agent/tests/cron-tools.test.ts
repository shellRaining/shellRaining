import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentCronJob } from "../src/cron/types.js";

function createJob(overrides: Partial<AgentCronJob> = {}): AgentCronJob {
  const base: AgentCronJob = {
    id: "job_123",
    name: "新闻总结",
    owner: {
      chatId: 1,
      threadId: "telegram:1",
      threadKey: "telegram__1",
    },
    enabled: true,
    removeAfterSuccess: false,
    createdAtMs: Date.parse("2026-04-16T09:00:00.000Z"),
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { kind: "agentTurn", message: "总结新闻" },
    state: { consecutiveErrors: 0, nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z") },
  };

  return {
    ...base,
    ...overrides,
    owner: {
      ...base.owner,
      ...overrides.owner,
    },
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
  const thread = { chatId: 1, threadId: "telegram:1", threadKey: "telegram__1" };

  it("creates jobs through cron_create without explicit thread params", async () => {
    const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
    const service = {
      add: vi.fn(async (job: AgentCronJob) => job),
      listJobs: vi.fn(async () => []),
      remove: vi.fn(async () => false),
    };
    const registerTool = vi.fn();

    await buildCronExtensionFactory(service as any, thread)(createExtensionApi(registerTool));

    const tool = getRegisteredTool(registerTool, "cron_create");
    const result = await tool.execute("tool_1", {
      name: "新闻总结",
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { kind: "agentTurn", message: "总结新闻" },
    });

    expect(service.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "新闻总结",
        owner: {
          chatId: 1,
          threadId: "telegram:1",
          threadKey: "telegram__1",
        },
        payload: { kind: "agentTurn", message: "总结新闻" },
      }),
    );
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("已创建定时任务：新闻总结");
  });

  it("lists jobs filtered by chat id from thread context", async () => {
    const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
    const service = {
      add: vi.fn(),
      listJobs: vi.fn(async () => [
        createJob({
          id: "job_chat_1",
          owner: { chatId: 1, threadId: "telegram:1", threadKey: "telegram__1" },
          name: "新闻总结",
        }),
        createJob({
          id: "job_chat_2",
          owner: { chatId: 2, threadId: "telegram:2", threadKey: "telegram__2" },
          name: "别的聊天",
        }),
      ]),
      remove: vi.fn(),
    };
    const registerTool = vi.fn();

    await buildCronExtensionFactory(service as any, thread)(createExtensionApi(registerTool));

    const tool = getRegisteredTool(registerTool, "cron_list");
    const result = await tool.execute("tool_2", {});

    expect(service.listJobs).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("新闻总结（job_chat_1）");
    expect(result.content[0]?.text).not.toContain("别的聊天");
  });

  it("forwards condition fields through cron_create", async () => {
    const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
    const service = {
      add: vi.fn(async (job: AgentCronJob) => job),
      listJobs: vi.fn(async () => []),
      remove: vi.fn(async () => false),
    };
    const registerTool = vi.fn();

    await buildCronExtensionFactory(service as any, thread)(createExtensionApi(registerTool));

    const tool = getRegisteredTool(registerTool, "cron_create");
    await tool.execute("tool_4", {
      name: "条件任务",
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { kind: "agentTurn", message: "处理数据" },
      condition: { command: "test -f /tmp/done", timeoutMs: 45000 },
    });

    expect(service.add).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: { command: "test -f /tmp/done", timeoutMs: 45000 },
      }),
    );
  });

  it("removes jobs through cron_remove", async () => {
    const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
    const service = {
      add: vi.fn(),
      listJobs: vi.fn(async () => []),
      remove: vi.fn(async () => true),
    };
    const registerTool = vi.fn();

    await buildCronExtensionFactory(service as any, thread)(createExtensionApi(registerTool));

    const tool = getRegisteredTool(registerTool, "cron_remove");
    const result = await tool.execute("tool_3", { id: "job_123" });

    expect(service.remove).toHaveBeenCalledWith("job_123");
    expect(result.content[0]?.text).toBe("已删除定时任务：job_123");
  });
});
