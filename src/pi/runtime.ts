import { mkdir } from "node:fs/promises";
import { createAgentSession, DefaultResourceLoader, SessionManager, type AgentSessionEvent, type SessionInfo } from "@mariozechner/pi-coding-agent";
import type { Config } from "../config.js";
import { getSessionDirectoryForThread } from "./session-store.js";
import { buildServiceProfileContext, createServiceProfile } from "../runtime/service-profile.js";

export interface PiPromptResult {
  artifactsOutput: string;
  error?: string;
  text: string;
}

export interface PiPromptCallbacks {
  onStatus?: (status: string) => Promise<void> | void;
}

interface CachedSession {
  cwd: string;
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
}

export class PiRuntime {
  private readonly sessions = new Map<string, CachedSession>();
  private readonly inflight = new Map<string, Promise<PiPromptResult>>();

  constructor(private readonly config: Config) {}

  private async getOrCreateSession(threadKey: string, cwd: string): Promise<CachedSession> {
    const existing = this.sessions.get(threadKey);
    if (existing && existing.cwd === cwd) {
      return existing;
    }

    if (existing && existing.cwd !== cwd) {
      existing.session.dispose();
      this.sessions.delete(threadKey);
    }

    const sessionDir = getSessionDirectoryForThread(this.config.baseDir, threadKey);
    await mkdir(sessionDir, { recursive: true });

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: this.config.agentDir,
      appendSystemPromptOverride: (base) => [
        ...base,
        buildServiceProfileContext(createServiceProfile(this.config)),
      ],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir: this.config.agentDir,
      resourceLoader,
      sessionManager: SessionManager.continueRecent(cwd, sessionDir),
    });

    const cached = { cwd, session };
    this.sessions.set(threadKey, cached);
    return cached;
  }

  async newSession(threadKey: string, cwd: string): Promise<void> {
    const { session } = await this.getOrCreateSession(threadKey, cwd);
    await session.newSession();
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

  async prompt(threadKey: string, text: string, cwd: string, callbacks: PiPromptCallbacks = {}): Promise<PiPromptResult> {
    const running = this.inflight.get(threadKey);
    if (running) {
      return running;
    }

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

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
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
      await session.prompt(text);
      return {
        artifactsOutput: `${output}\n${toolOutput}`.trim(),
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
}
