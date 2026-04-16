import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CronStoreData } from "./types.js";

function createEmptyStore(): CronStoreData {
  return {
    version: 1,
    jobs: [],
  };
}

export class CronStore {
  constructor(private readonly jobsPath: string) {}

  async load(): Promise<CronStoreData> {
    try {
      const raw = await readFile(this.jobsPath, "utf8");
      const parsed = JSON.parse(raw) as CronStoreData;

      return {
        version: 1,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyStore();
      }
      throw error;
    }
  }

  async save(data: CronStoreData): Promise<void> {
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
