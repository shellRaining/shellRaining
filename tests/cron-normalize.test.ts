import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("nanoid", () => ({
  nanoid: () => "job_123",
}));

describe("cron normalize", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills defaults for a one-shot job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T09:00:00.000Z"));

    const { normalizeCronJobInput } = await import("../src/cron/normalize.js");

    const job = normalizeCronJobInput({
      name: "  新闻总结  ",
      chatId: 1,
      threadId: "telegram:1",
      threadKey: "telegram__1",
      schedule: { kind: "at", at: "2026-04-17T07:00:00+08:00" },
      payload: { kind: "agentTurn", message: "  总结新闻  " },
    });

    expect(job).toEqual({
      id: "job_123",
      name: "新闻总结",
      chatId: 1,
      threadId: "telegram:1",
      threadKey: "telegram__1",
      enabled: true,
      deleteAfterRun: true,
      createdAtMs: Date.parse("2026-04-16T09:00:00.000Z"),
      schedule: { kind: "at", at: "2026-04-17T07:00:00+08:00" },
      payload: { kind: "agentTurn", message: "总结新闻" },
      state: { consecutiveErrors: 0 },
    });
  });

  it("rejects empty prompt payloads", async () => {
    const { normalizeCronJobInput } = await import("../src/cron/normalize.js");

    expect(() =>
      normalizeCronJobInput({
        name: "bad",
        chatId: 1,
        threadId: "telegram:1",
        threadKey: "telegram__1",
        schedule: { kind: "every", everyMs: 60_000 },
        payload: { kind: "agentTurn", message: "   " },
      }),
    ).toThrow(/message/i);
  });
});
