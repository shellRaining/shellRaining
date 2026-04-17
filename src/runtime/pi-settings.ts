import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface PiSettings {
  skills?: string[];
  [key: string]: unknown;
}

export interface SyncPiSettingsOptions {
  agentDir: string;
  skillsDir: string;
  backupDir: string;
  timestamp?: string;
}

export interface SyncPiSettingsResult {
  changed: boolean;
  settingsPath: string;
}

function normalizeTimestamp(timestamp: string | undefined): string {
  return (timestamp || new Date().toISOString()).replace(/[:.]/g, "-");
}

function buildNextSettings(settings: PiSettings, skillsDir: string): PiSettings {
  const existingSkills = Array.isArray(settings.skills) ? settings.skills : [];
  if (existingSkills.includes(skillsDir)) {
    return settings;
  }

  return {
    ...settings,
    skills: [...existingSkills, skillsDir],
  };
}

export async function syncPiSettings(
  options: SyncPiSettingsOptions,
): Promise<SyncPiSettingsResult> {
  const settingsPath = join(options.agentDir, "settings.json");
  await mkdir(options.agentDir, { recursive: true });

  let currentSettings: PiSettings = {};
  try {
    const content = await readFile(settingsPath, "utf-8");
    currentSettings = JSON.parse(content) as PiSettings;
  } catch {
    currentSettings = {};
  }

  const nextSettings = buildNextSettings(currentSettings, options.skillsDir);
  const changed = JSON.stringify(nextSettings) !== JSON.stringify(currentSettings);

  if (!changed) {
    return { changed: false, settingsPath };
  }

  try {
    const existing = await stat(settingsPath);
    if (existing.isFile()) {
      await mkdir(options.backupDir, { recursive: true });
      const backupPath = join(
        options.backupDir,
        `pi-settings-${normalizeTimestamp(options.timestamp)}.json`,
      );
      await copyFile(settingsPath, backupPath);
    }
  } catch {
    // No existing settings file to back up.
  }

  await writeFile(settingsPath, JSON.stringify(nextSettings, null, 2));
  return { changed: true, settingsPath };
}
