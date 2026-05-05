import { beforeEach, describe, expect, it, vi } from "vitest";

const childLogger = {
  child: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  flush: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
};
const rootLogger = {
  child: vi.fn(() => childLogger),
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  flush: vi.fn(),
  info: vi.fn(),
  level: "info",
  trace: vi.fn(),
  warn: vi.fn(),
};
const pinoMock = vi.fn(() => rootLogger);
const destinationMock = vi.fn(() => ({ fd: 2 }));

vi.mock("pino", () => ({
  default: Object.assign(pinoMock, { destination: destinationMock }),
}));

function loggingConfig() {
  return {
    file: {
      enabled: true,
      frequency: "daily" as const,
      limit: {
        count: 10,
      },
      mkdir: true,
      path: "/tmp/shellraining.log",
    },
    level: "info" as const,
  };
}

describe("log service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rootLogger.level = "info";
    pinoMock.mockReturnValue(rootLogger);
  });

  it("creates a pino logger with stdout and rolling file targets", async () => {
    const { createLogService } = await import("../src/logging/service.js");

    createLogService(loggingConfig());

    expect(pinoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        redact: expect.objectContaining({ censor: "[redacted]" }),
        transport: {
          targets: [
            { level: "info", options: { destination: 1 }, target: "pino/file" },
            {
              level: "info",
              options: {
                file: "/tmp/shellraining.log",
                frequency: "daily",
                limit: {
                  count: 10,
                },
                mkdir: true,
              },
              target: "pino-roll",
            },
          ],
        },
      }),
    );
  });

  it("creates child loggers with bindings", async () => {
    const { createLogService } = await import("../src/logging/service.js");
    const service = createLogService(loggingConfig());

    expect(service.child({ component: "test" })).toBe(childLogger);
    expect(rootLogger.child).toHaveBeenCalledWith({ component: "test" });
  });

  it("updates the root logger level", async () => {
    const { createLogService } = await import("../src/logging/service.js");
    const service = createLogService(loggingConfig());

    service.setLevel("debug");

    expect(rootLogger.level).toBe("debug");
  });

  it("falls back to stderr when transport setup fails", async () => {
    pinoMock.mockImplementationOnce(() => {
      throw new Error("transport failed");
    });
    pinoMock.mockReturnValueOnce(rootLogger);
    const { createLogService } = await import("../src/logging/service.js");

    createLogService(loggingConfig());

    expect(destinationMock).toHaveBeenCalledWith(2);
    expect(rootLogger.error).toHaveBeenCalledWith(
      { error: expect.any(Error), event: "logging.fallback" },
      "log service transport setup failed; using stderr fallback",
    );
  });
});
