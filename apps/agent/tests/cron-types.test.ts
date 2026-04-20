import { describe, expect, it } from "vitest";
import type { CronJob } from "../src/cron/types.js";

describe("CronJob types", () => {
  it("supports one-shot jobs with execution state", () => {
    const job: CronJob = {
      id: "job_123",
      name: "早上新闻总结",
      chatId: 123,
      threadId: "telegram:123",
      threadKey: "telegram__123",
      enabled: true,
      deleteAfterRun: true,
      createdAtMs: 1,
      schedule: { kind: "at", at: "2026-04-17T07:00:00+08:00" },
      payload: { kind: "agentTurn", message: "总结今天的新闻" },
      state: { consecutiveErrors: 0 },
    };

    expect(job.schedule.kind).toBe("at");
    expect(job.payload.kind).toBe("agentTurn");
  });
});
