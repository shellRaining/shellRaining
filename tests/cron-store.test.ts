import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CronStoreData } from "../src/cron/types.js";

let tempRoot: string;

describe("CronStore", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "shellraining-cron-store-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("returns an empty store when the file does not exist", async () => {
    const { CronStore } = await import("../src/cron/store.js");

    const store = new CronStore(join(tempRoot, "cron", "jobs.json"));

    await expect(store.load()).resolves.toEqual({
      version: 1,
      jobs: [],
    });
  });

  it("persists jobs across save and load", async () => {
    const { CronStore } = await import("../src/cron/store.js");

    const storePath = join(tempRoot, "cron", "jobs.json");
    const store = new CronStore(storePath);
    const data: CronStoreData = {
      version: 1,
      jobs: [
        {
          id: "job_123",
          name: "Daily summary",
          chatId: 42,
          threadId: "telegram:42",
          threadKey: "telegram__42",
          enabled: true,
          deleteAfterRun: false,
          createdAtMs: 1713200000000,
          schedule: { kind: "cron", expr: "0 9 * * *" },
          payload: { kind: "agentTurn", message: "Send the daily summary" },
          state: { consecutiveErrors: 0 },
        },
      ],
    };

    await store.save(data);

    const disk = JSON.parse(await readFile(storePath, "utf-8")) as CronStoreData;
    expect(disk).toEqual(data);
    await expect(store.load()).resolves.toEqual(data);
  });
});
