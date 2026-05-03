import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CronStoreData } from "./types.js";

function createEmptyStore<TPayload, TOwner>(): CronStoreData<TPayload, TOwner> {
  return {
    version: 1,
    jobs: [],
  };
}

function isCronStoreData<TPayload, TOwner>(
  value: unknown,
): value is CronStoreData<TPayload, TOwner> {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    (value as Record<string, unknown>).version === 1 &&
    "jobs" in value &&
    Array.isArray((value as Record<string, unknown>).jobs)
  );
}

function parseStoreData<TPayload, TOwner>(raw: string): CronStoreData<TPayload, TOwner> {
  const parsed: unknown = JSON.parse(raw);
  if (isCronStoreData<TPayload, TOwner>(parsed)) {
    return parsed;
  }
  return createEmptyStore<TPayload, TOwner>();
}

export class CronStore<TPayload = unknown, TOwner = unknown> {
  constructor(private readonly jobsPath: string) {}

  async load(): Promise<CronStoreData<TPayload, TOwner>> {
    try {
      const raw = await readFile(this.jobsPath, "utf8");
      return parseStoreData<TPayload, TOwner>(raw);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as Record<string, unknown>).code === "ENOENT"
      ) {
        return createEmptyStore<TPayload, TOwner>();
      }
      throw error;
    }
  }

  async save(data: CronStoreData<TPayload, TOwner>): Promise<void> {
    await mkdir(dirname(this.jobsPath), { recursive: true });

    const next = JSON.stringify(
      {
        version: 1,
        jobs: data.jobs,
      },
      null,
      2,
    );
    const tempPath = `${this.jobsPath}.tmp`;

    await writeFile(tempPath, `${next}\n`, "utf8");
    await rename(tempPath, this.jobsPath);
  }
}
