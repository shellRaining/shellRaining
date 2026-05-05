import { describe, expect, it } from "vitest";

import type { Config } from "../src/config/index.js";
import { buildEffectiveConfig, classifyConfigChangePaths } from "../src/config/index.js";

function createConfig(): Config {
  return {
    agents: {
      default: {
        aliases: [],
        displayName: "shellRaining",
        id: "default",
        personaRoot: "/base/agents/default",
        piProfile: "default",
        profileRoot: "/base/pi-profiles/default",
      },
    },
    cron: { jobsPath: "/base/cron/jobs.json", misfireGraceMs: 300000, runTimeoutMs: 300000 },
    logging: {
      file: {
        enabled: true,
        frequency: "daily",
        limit: {
          count: 10,
        },
        mkdir: true,
        path: "/base/logs/shellraining.log",
      },
      level: "info",
    },
    paths: { baseDir: "/base", workspace: "/workspace" },
    server: { port: 3457 },
    stt: {},
    telegram: {
      allowedUsers: [1],
      botToken: "token",
      defaultAgent: "default",
      showThinking: false,
    },
  };
}

describe("config changes", () => {
  it("classifies first-phase hot config paths", () => {
    expect(
      classifyConfigChangePaths([
        ["telegram", "allowedUsers"],
        ["telegram", "showThinking"],
        ["stt", "apiKey"],
        ["stt", "baseUrl"],
        ["stt", "model"],
      ]),
    ).toEqual({
      hot: [
        "telegram.allowedUsers",
        "telegram.showThinking",
        "stt.apiKey",
        "stt.baseUrl",
        "stt.model",
      ],
      restartRequired: [],
      unsupported: [],
    });
  });

  it("classifies restart-required config paths", () => {
    expect(
      classifyConfigChangePaths([
        ["server", "port"],
        ["telegram", "botToken"],
        ["telegram", "apiBaseUrl"],
        ["telegram", "webhookSecret"],
        ["telegram", "defaultAgent"],
        ["paths", "baseDir"],
        ["paths", "workspace"],
        ["agents"],
        ["cron", "jobsPath"],
        ["cron", "runTimeoutMs"],
        ["cron", "misfireGraceMs"],
      ]),
    ).toEqual({
      hot: [],
      restartRequired: [
        "server.port",
        "telegram.botToken",
        "telegram.apiBaseUrl",
        "telegram.webhookSecret",
        "telegram.defaultAgent",
        "paths.baseDir",
        "paths.workspace",
        "agents",
        "cron.jobsPath",
        "cron.runTimeoutMs",
        "cron.misfireGraceMs",
      ],
      unsupported: [],
    });
  });

  it("classifies logging config paths", () => {
    expect(
      classifyConfigChangePaths([
        ["logging", "level"],
        ["logging", "file", "enabled"],
        ["logging", "file", "path"],
        ["logging", "file", "frequency"],
        ["logging", "file", "limit"],
        ["logging", "file", "mkdir"],
      ]),
    ).toEqual({
      hot: ["logging.level"],
      restartRequired: [
        "logging.file.enabled",
        "logging.file.path",
        "logging.file.frequency",
        "logging.file.limit",
        "logging.file.mkdir",
      ],
      unsupported: [],
    });
  });

  it("classifies unknown config paths as unsupported", () => {
    expect(
      classifyConfigChangePaths([
        ["stt", "enabled"],
        ["telegram", "parseMode"],
      ]),
    ).toEqual({
      hot: [],
      restartRequired: [],
      unsupported: ["stt.enabled", "telegram.parseMode"],
    });
  });

  it("normalizes deep diff paths to supported config boundaries without duplicates", () => {
    expect(
      classifyConfigChangePaths([
        ["telegram", "allowedUsers", "0"],
        ["telegram", "allowedUsers", "1"],
        ["telegram", "showThinking"],
        ["stt", "apiKey"],
        ["agents", "default", "displayName"],
        ["agents", "default", "aliases", "0"],
        ["cron", "jobsPath", "value"],
        ["telegram", "parseMode", "nested"],
      ]),
    ).toEqual({
      hot: ["telegram.allowedUsers", "telegram.showThinking", "stt.apiKey"],
      restartRequired: ["agents", "cron.jobsPath"],
      unsupported: ["telegram.parseMode.nested"],
    });
  });

  it("builds effective config by applying only hot changes", () => {
    const previous = createConfig();
    const next = createConfig();
    next.telegram.allowedUsers = [2, 3];
    next.telegram.showThinking = true;
    next.telegram.botToken = "next-token";
    next.server.port = 4567;
    next.paths.baseDir = "/next-base";
    next.logging = {
      file: {
        enabled: false,
        frequency: "daily",
        limit: {
          count: 20,
        },
        mkdir: false,
        path: "/next/logs/shellraining.log",
      },
      level: "debug",
    };
    next.stt = {
      apiKey: "next-api-key",
      baseUrl: "https://stt.example.com",
      model: "next-model",
    };

    const effective = buildEffectiveConfig(
      previous,
      next,
      classifyConfigChangePaths([
        ["telegram", "allowedUsers"],
        ["telegram", "showThinking"],
        ["telegram", "botToken"],
        ["server", "port"],
        ["paths", "baseDir"],
        ["logging", "level"],
        ["logging", "file", "path"],
        ["stt", "apiKey"],
        ["stt", "baseUrl"],
        ["stt", "model"],
      ]),
    );

    expect(effective.telegram.allowedUsers).toEqual([2, 3]);
    expect(effective.telegram.allowedUsers).not.toBe(next.telegram.allowedUsers);
    expect(effective.telegram.showThinking).toBe(true);
    expect(effective.stt).toEqual({
      apiKey: "next-api-key",
      baseUrl: "https://stt.example.com",
      model: "next-model",
    });
    expect(effective.telegram.botToken).toBe("token");
    expect(effective.server.port).toBe(3457);
    expect(effective.paths.baseDir).toBe("/base");
    expect(effective.logging.level).toBe("debug");
    expect(effective.logging.file).toEqual(previous.logging.file);
  });

  it("applies stt object additions from parent change paths", () => {
    const previous = createConfig();
    const next = createConfig();
    next.stt = {
      apiKey: "next-api-key",
      baseUrl: "https://stt.example.com",
      model: "next-model",
    };

    const effective = buildEffectiveConfig(previous, next, classifyConfigChangePaths([["stt"]]));

    expect(effective.stt).toEqual({
      apiKey: "next-api-key",
      baseUrl: "https://stt.example.com",
      model: "next-model",
    });
  });

  it("clears stt values when the stt object is removed", () => {
    const previous = createConfig();
    previous.stt = {
      apiKey: "previous-api-key",
      baseUrl: "https://previous-stt.example.com",
      model: "previous-model",
    };
    const next = createConfig();
    next.stt = {};

    const effective = buildEffectiveConfig(previous, next, classifyConfigChangePaths([["stt"]]));

    expect(effective.stt).toEqual({});
  });

  it("clones restart-required agent config from previous effective config", () => {
    const previous = createConfig();
    previous.agents.default = {
      ...previous.agents.default,
      aliases: ["rain"],
    };
    const next = createConfig();
    next.agents.default = {
      ...next.agents.default,
      aliases: ["next"],
      displayName: "Next Agent",
    };

    const effective = buildEffectiveConfig(previous, next, classifyConfigChangePaths([["agents"]]));

    expect(effective.agents).toEqual(previous.agents);
    expect(effective.agents.default).not.toBe(previous.agents.default);
    expect(effective.agents.default?.aliases).toEqual(["rain"]);
    expect(effective.agents.default?.aliases).not.toBe(previous.agents.default.aliases);
    expect(effective.agents.default?.displayName).toBe("shellRaining");
  });
});
