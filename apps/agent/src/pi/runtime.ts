import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSessionEvent,
  type ExtensionFactory,
  type SessionInfo,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../config.js";
import { buildShellRainingSystemPrompt } from "@shellraining/system-prompt";
import { SkillWatcher } from "./skill-watcher.js";
import { getSessionDirectoryForThread } from "./session-store.js";

export interface PiPromptResult {
  artifactsOutput: string;
  error?: string;
  text: string;
}

export interface PiImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

export interface PiPromptCallbacks {
  images?: PiImageInput[];
  onStatus?: (status: string) => Promise<void> | void;
}

interface PiRuntimeOptions {
  extensionFactories?: (threadKey: string) => ExtensionFactory[];
}

interface CachedSession {
  cwd: string;
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
}

interface AssistantErrorMessage {
  errorMessage?: unknown;
  role?: unknown;
  stopReason?: unknown;
}

function getAssistantErrorMessage(event: AgentSessionEvent): string | undefined {
  if (event.type !== "message_end" && event.type !== "turn_end") {
    return undefined;
  }

  const message = event.message as AssistantErrorMessage;
  if (
    message.role !== "assistant" ||
    message.stopReason !== "error" ||
    typeof message.errorMessage !== "string"
  ) {
    return undefined;
  }

  return message.errorMessage.trim() || undefined;
}

export class PiRuntime {
  private readonly sessions = new Map<string, CachedSession>();
  /**
   * Tracks in-flight prompt executions per thread so that `steer()` can
   * await the running promise when injecting a mid-session message.
   */
  private readonly inflight = new Map<string, Promise<PiPromptResult>>();
  private skillWatcher: SkillWatcher | undefined;

  constructor(
    private readonly config: Config,
    private readonly options: PiRuntimeOptions = {},
  ) {}

  private async createSession(
    threadKey: string,
    cwd: string,
    mode: "continue" | "new",
  ): Promise<CachedSession> {
    const sessionDir = getSessionDirectoryForThread(this.config.baseDir, threadKey);
    await mkdir(sessionDir, { recursive: true });

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: this.config.agentDir,
      extensionFactories: this.options.extensionFactories?.(threadKey),
      appendSystemPromptOverride: (base) => [
        ...base,
        buildShellRainingSystemPrompt({
          environmentName: "shellRaining",
          telegram: {
            inboxDir: "~/.shellRaining/inbox/",
            outputStyle: "chat",
          },
        }),
      ],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir: this.config.agentDir,
      resourceLoader,
      sessionManager:
        mode === "new"
          ? SessionManager.create(cwd, sessionDir)
          : SessionManager.continueRecent(cwd, sessionDir),
    });

    if (this.config.providerBaseUrl) {
      session.modelRegistry.registerProvider("shellraining", {
        baseUrl: this.config.providerBaseUrl,
      });
    }

    const cached = { cwd, session };
    this.sessions.set(threadKey, cached);

    await this.ensureSkillWatcher(cwd, resourceLoader, session);

    return cached;
  }

  private async ensureSkillWatcher(
    cwd: string,
    resourceLoader: DefaultResourceLoader,
    session: Awaited<ReturnType<typeof createAgentSession>>["session"],
  ): Promise<void> {
    const projectSkillsDir = join(cwd, ".claude", "skills");
    const agentSkillsDir = join(this.config.agentDir, "skills");

    if (!this.skillWatcher) {
      this.skillWatcher = new SkillWatcher({
        paths: [this.config.skillsDir, agentSkillsDir, projectSkillsDir],
        debounceMs: 500,
        onReload: async () => {
          await resourceLoader.reload();
          session.setActiveToolsByName(session.getActiveToolNames());
        },
      });
      return;
    }

    await this.skillWatcher.addPath(projectSkillsDir);
  }

  private async getOrCreateSession(threadKey: string, cwd: string): Promise<CachedSession> {
    const existing = this.sessions.get(threadKey);
    if (existing && existing.cwd === cwd) {
      return existing;
    }

    if (existing && existing.cwd !== cwd) {
      existing.session.dispose();
      this.sessions.delete(threadKey);
    }

    return this.createSession(threadKey, cwd, "continue");
  }

  async newSession(threadKey: string, cwd: string): Promise<void> {
    const existing = this.sessions.get(threadKey);
    if (existing) {
      existing.session.dispose();
      this.sessions.delete(threadKey);
    }

    await this.createSession(threadKey, cwd, "new");
  }

  async listSessions(threadKey: string, cwd: string): Promise<SessionInfo[]> {
    const sessionDir = getSessionDirectoryForThread(this.config.baseDir, threadKey);
    await mkdir(sessionDir, { recursive: true });
    return SessionManager.list(cwd, sessionDir);
  }

  async switchSession(threadKey: string, cwd: string, sessionPath: string): Promise<boolean> {
    const { session } = await this.getOrCreateSession(threadKey, cwd);
    return session.switchSession(sessionPath);
  }

  isRunning(threadKey: string): boolean {
    return this.inflight.has(threadKey);
  }

  /**
   * Inject a message into an already-running session (used for mid-turn
   * steering). Throws if no session or no inflight prompt exists for the thread.
   * Returns the inflight prompt's result once it completes.
   */
  async steer(threadKey: string, text: string, images?: PiImageInput[]): Promise<PiPromptResult> {
    const cached = this.sessions.get(threadKey);
    if (!cached) {
      throw new Error(`No active session for thread: ${threadKey}`);
    }
    await cached.session.steer(text, images);
    const running = this.inflight.get(threadKey);
    if (!running) {
      throw new Error(`No inflight prompt for thread: ${threadKey}`);
    }
    return running;
  }

  /**
   * Execute a prompt and register it in `inflight` *before* starting so that
   * concurrent `steer()` calls can discover and await it. The entry is removed
   * in a `finally` block regardless of outcome.
   */
  async prompt(
    threadKey: string,
    text: string,
    cwd: string,
    callbacks: PiPromptCallbacks = {},
  ): Promise<PiPromptResult> {
    const execution = this.runPrompt(threadKey, text, cwd, callbacks);
    this.inflight.set(threadKey, execution);
    try {
      return await execution;
    } finally {
      this.inflight.delete(threadKey);
    }
  }

  private async runPrompt(
    threadKey: string,
    text: string,
    cwd: string,
    callbacks: PiPromptCallbacks,
  ): Promise<PiPromptResult> {
    const { session } = await this.getOrCreateSession(threadKey, cwd);
    let output = "";
    let toolOutput = "";
    let assistantError: string | undefined;

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      const eventError = getAssistantErrorMessage(event);
      if (eventError) {
        assistantError = eventError;
      }

      if (event.type === "message_update") {
        if (event.assistantMessageEvent.type === "text_delta") {
          output += event.assistantMessageEvent.delta;
        }
        if (this.config.showThinking && event.assistantMessageEvent.type === "thinking_delta") {
          output += event.assistantMessageEvent.delta;
        }
      }

      if (event.type === "tool_execution_start") {
        void callbacks.onStatus?.(`正在执行 ${event.toolName}`);
      }

      if (event.type === "tool_execution_update") {
        if (typeof event.partialResult === "string") {
          toolOutput += event.partialResult;
        } else if (event.partialResult !== undefined) {
          toolOutput += JSON.stringify(event.partialResult);
        }
      }

      if (event.type === "agent_start") {
        void callbacks.onStatus?.("正在思考...");
      }
    });

    try {
      await session.prompt(
        text,
        callbacks.images?.length ? { images: callbacks.images } : undefined,
      );
      const artifactsOutput = `${output}\n${toolOutput}`.trim();
      if (assistantError) {
        return {
          artifactsOutput,
          error: assistantError,
          text: output,
        };
      }

      return {
        artifactsOutput,
        text: output || "(no output)",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        artifactsOutput: `${output}\n${toolOutput}`.trim(),
        error: message,
        text: output,
      };
    } finally {
      unsubscribe();
    }
  }

  async dispose(): Promise<void> {
    for (const { session } of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    await this.skillWatcher?.dispose();
    this.skillWatcher = undefined;
  }
}
