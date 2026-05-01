import { join } from "node:path";
import type { ResolvedAgentConfig, ShellRainingConfigFile } from "./schema.js";

function isSafeRegistryId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function assertSafeAgentId(agentId: string): void {
  if (!isSafeRegistryId(agentId)) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
}

function assertSafePiProfileId(profileId: string): void {
  if (!isSafeRegistryId(profileId)) {
    throw new Error(`Invalid Pi profile id: ${profileId}`);
  }
}

function normalizeAliases(aliases: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const alias of aliases ?? []) {
    const trimmed = alias.trim();
    if (!trimmed) {
      continue;
    }
    if (!isSafeRegistryId(trimmed)) {
      throw new Error(`Invalid agent alias: ${trimmed}`);
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  return normalized;
}

export function resolveAgents(
  agents: ShellRainingConfigFile["agents"],
  baseDir: string,
): Record<string, ResolvedAgentConfig> {
  const entries = agents && Object.keys(agents).length > 0 ? agents : undefined;
  if (!entries) {
    return {
      default: {
        aliases: [],
        displayName: "shellRaining",
        id: "default",
        piProfile: "default",
        profileRoot: join(baseDir, "pi-profiles", "default"),
      },
    };
  }

  const resolved: Record<string, ResolvedAgentConfig> = {};
  const claimedIds = new Set<string>();
  for (const agentId of Object.keys(entries).sort()) {
    assertSafeAgentId(agentId);
    if (claimedIds.has(agentId)) {
      throw new Error(`Duplicate agent alias or id: ${agentId}`);
    }
    claimedIds.add(agentId);
  }

  for (const agentId of Object.keys(entries).sort()) {
    const agent = entries[agentId];
    const piProfile = agent?.piProfile?.trim() || agentId;
    assertSafePiProfileId(piProfile);
    const aliases = normalizeAliases(agent?.aliases);
    for (const alias of aliases) {
      if (claimedIds.has(alias)) {
        throw new Error(`Duplicate agent alias or id: ${alias}`);
      }
      claimedIds.add(alias);
    }
    resolved[agentId] = {
      aliases,
      displayName: agent?.displayName?.trim() || agentId,
      id: agentId,
      piProfile,
      profileRoot: join(baseDir, "pi-profiles", piProfile),
    };
  }

  return resolved;
}

export function resolveDefaultAgent(
  configuredDefaultAgent: string | undefined,
  agents: Record<string, ResolvedAgentConfig>,
): string {
  const configured = configuredDefaultAgent?.trim();
  if (configured && agents[configured]) {
    return configured;
  }
  if (configured) {
    throw new Error(`Default agent is not configured: ${configured}`);
  }
  return Object.keys(agents).sort()[0] ?? "default";
}
