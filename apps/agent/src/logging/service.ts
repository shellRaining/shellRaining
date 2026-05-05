import pino from "pino";
import type { Config, LogLevel } from "../config/index.js";

export type LogBindings = Record<string, unknown>;
export type LogFields = Record<string, unknown>;

export interface Logger {
  trace(fields: LogFields, message?: string): void;
  debug(fields: LogFields, message?: string): void;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
  fatal(fields: LogFields, message?: string): void;
  child(bindings: LogBindings): Logger;
}

interface PinoLikeLogger extends Logger {
  flush?: () => void;
  level: string;
}

export interface LogService {
  logger(): Logger;
  child(bindings: LogBindings): Logger;
  setLevel(level: LogLevel): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export type LoggingConfig = Config["logging"];

const redactPaths = [
  "telegram.botToken",
  "telegram.webhookSecret",
  "stt.apiKey",
  "botToken",
  "webhookSecret",
  "apiKey",
  "token",
  "secret",
];

const noop = () => {};

export function createLogService(config: LoggingConfig): LogService {
  const targets: Array<{ level: LogLevel; options: Record<string, unknown>; target: string }> = [
    { level: config.level, options: { destination: 1 }, target: "pino/file" },
  ];
  if (config.file.enabled) {
    targets.push({
      level: config.level,
      options: {
        file: config.file.path,
        frequency: config.file.frequency,
        limit: config.file.limit,
        mkdir: config.file.mkdir,
      },
      target: "pino-roll",
    });
  }

  let root: PinoLikeLogger;
  try {
    root = pino({
      base: { service: "shellRaining" },
      level: config.level,
      redact: { censor: "[redacted]", paths: redactPaths },
      transport: { targets },
    });
  } catch (error) {
    root = pino(
      {
        base: { loggingFallback: true, service: "shellRaining" },
        level: config.level,
        redact: { censor: "[redacted]", paths: redactPaths },
      },
      pino.destination(2),
    );
    root.error(
      { error, event: "logging.fallback" },
      "log service transport setup failed; using stderr fallback",
    );
  }

  return {
    child(bindings) {
      return root.child(bindings);
    },
    flush() {
      root.flush?.();
      return Promise.resolve();
    },
    logger() {
      return root;
    },
    setLevel(level) {
      root.level = level;
    },
    stop() {
      root.flush?.();
      return Promise.resolve();
    },
  };
}

export function createNoopLogger(): Logger {
  const logger: Logger = {
    child: () => logger,
    debug: noop,
    error: noop,
    fatal: noop,
    info: noop,
    trace: noop,
    warn: noop,
  };
  return logger;
}
