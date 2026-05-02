import { Type, type Static } from "@sinclair/typebox";
import { DEFAULT_BASE_DIR, DEFAULT_WORKSPACE } from "./path.js";

/** Application configuration loaded from environment variables (or `.env` file). */
export interface Config {
  server: {
    /** HTTP server listen port. @defaultValue 3457 */
    port: number;
  };
  telegram: {
    /** Telegram Bot API token. **Required.** */
    botToken: string;
    /** Custom Telegram Bot API base URL (e.g. for a local Bot API server). */
    apiBaseUrl?: string;
    /** Secret for verifying incoming webhook requests. */
    webhookSecret?: string;
    /** Telegram user IDs allowed to interact with the bot. Empty = all users blocked. */
    allowedUsers: number[];
    /** Default Telegram-visible agent id. */
    defaultAgent: string;
    /** Whether to include the agent's thinking output in Telegram replies. @defaultValue false */
    showThinking: boolean;
  };
  paths: {
    /** Root directory for persistent shellRaining data (sessions, cron store, etc.). */
    baseDir: string;
    /** Directory where Pi agent workspaces are created (per-thread subdirectories). */
    workspace: string;
  };
  /** Telegram-visible agents mapped to derived Pi profile roots. */
  agents: Record<string, ResolvedAgentConfig>;
  cron: {
    /** File path for persisting cron jobs to disk. */
    jobsPath: string;
    /** Maximum wall-clock time (ms) for a single cron prompt execution. @defaultValue 300000 (5 min) */
    runTimeoutMs: number;
    /** If a job missed its scheduled time by less than this window (ms), run it anyway. @defaultValue 300000 (5 min) */
    misfireGraceMs: number;
  };
  /** Speech-to-text (Whisper-compatible) configuration for transcribing voice messages. */
  stt: {
    /** API key for the STT service. */
    apiKey?: string;
    /** Base URL of the Whisper-compatible STT endpoint. */
    baseUrl?: string;
    /** Model name to request from the STT service. */
    model?: string;
  };
}

export interface ResolvedAgentConfig {
  id: string;
  aliases: string[];
  displayName: string;
  piProfile: string;
  profileRoot: string;
}

export const shellRainingConfigFileSchema = Type.Object(
  {
    server: Type.Optional(
      Type.Object(
        {
          port: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
    ),
    telegram: Type.Optional(
      Type.Object(
        {
          botToken: Type.Optional(Type.String()),
          apiBaseUrl: Type.Optional(Type.String()),
          webhookSecret: Type.Optional(Type.String()),
          allowedUsers: Type.Optional(Type.Array(Type.Number())),
          defaultAgent: Type.Optional(Type.String()),
          showThinking: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    paths: Type.Optional(
      Type.Object(
        {
          baseDir: Type.Optional(Type.String()),
          workspace: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    agents: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Object(
          {
            displayName: Type.Optional(Type.String()),
            piProfile: Type.Optional(Type.String()),
            aliases: Type.Optional(Type.Array(Type.String())),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    cron: Type.Optional(
      Type.Object(
        {
          jobsPath: Type.Optional(Type.String()),
          runTimeoutMs: Type.Optional(Type.Number()),
          misfireGraceMs: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
    ),
    stt: Type.Optional(
      Type.Object(
        {
          apiKey: Type.Optional(Type.String()),
          baseUrl: Type.Optional(Type.String()),
          model: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    $id: "https://shellraining.local/schema/config.schema.json",
    additionalProperties: false,
    title: "shellRaining Config",
  },
);

export type ShellRainingConfigFile = Static<typeof shellRainingConfigFileSchema>;

export const shellRainingConfigDefaults: ShellRainingConfigFile = {
  cron: {
    misfireGraceMs: 5 * 60 * 1000,
    runTimeoutMs: 5 * 60 * 1000,
  },
  paths: {
    baseDir: DEFAULT_BASE_DIR,
    workspace: DEFAULT_WORKSPACE,
  },
  server: {
    port: 3457,
  },
  telegram: {
    allowedUsers: [],
    showThinking: false,
  },
};
