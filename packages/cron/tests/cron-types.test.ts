import { describe, expectTypeOf, it } from "vitest";
import type { CronJob, CronStoreData } from "../src/index.js";

interface TestPayload {
  kind: "test";
  message: string;
}

interface TestOwner {
  tenantId: string;
}

describe("CronJob types", () => {
  it("keeps payload and owner generic", () => {
    const job: CronJob<TestPayload, TestOwner> = {
      id: "job_1",
      name: "generic job",
      owner: { tenantId: "tenant_1" },
      enabled: true,
      removeAfterSuccess: true,
      createdAtMs: 1,
      schedule: { kind: "at", at: "2026-04-17T07:00:00.000Z" },
      payload: { kind: "test", message: "run" },
      state: { consecutiveErrors: 0 },
    };

    const data: CronStoreData<TestPayload, TestOwner> = {
      version: 1,
      jobs: [job],
    };

    expectTypeOf(data.jobs[0]!.payload).toEqualTypeOf<TestPayload>();
    expectTypeOf(data.jobs[0]!.owner).toEqualTypeOf<TestOwner>();
  });
});
