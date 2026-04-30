import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
  type ExtensionFactory,
  type SessionInfo,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../config.js";
import { buildShellRainingSystemPrompt } from "@shellraining/system-prompt";
import { getSessionDirectoryForScope, getSessionDirectoryForThread } from "./session-store.js";

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

export interface RuntimeScope {
  agentId: string;
  threadKey: string;
}

interface PiRuntimeOptions {
  extensionFactories?: (threadKey: string) => ExtensionFactory[];
}

interface CachedSession {
  cwd: string;
  sessionDir: string;
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
}

type RuntimeScopeInput = RuntimeScope | string;

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

function getScopeKey(scope: RuntimeScope): string {
  return JSON.stringify([scope.agentId, scope.threadKey]);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class PiRuntime {
  private readonly sessions = new Map<string, CachedSession>();
  /** Tracks in-flight prompt executions per runtime scope for mid-session steering. */
  private readonly inflight = new Map<string, Promise<PiPromptResult>>();

  constructor(
    private readonly config: Config,
    private readonly options: PiRuntimeOptions = {},
  ) {}

  private async createSession(
    scope: RuntimeScope,
    cwd: string,
    mode: "continue" | "new",
  ): Promise<CachedSession> {
    const profileRoot = this.getAgentProfileRoot(scope.agentId);
    const sessionDir = await this.resolveSessionDir(scope, mode);
    await mkdir(sessionDir, { recursive: true });
    const authStorage = AuthStorage.create(join(profileRoot, "auth.json"));
    const modelRegistry = new ModelRegistry(authStorage, join(profileRoot, "models.json"));
    const settingsManager = SettingsManager.create(cwd, profileRoot);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: profileRoot,
      settingsManager,
      extensionFactories: this.options.extensionFactories?.(scope.threadKey),
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
      agentDir: profileRoot,
      authStorage,
      modelRegistry,
      settingsManager,
      resourceLoader,
      sessionManager:
        mode === "new"
          ? SessionManager.create(cwd, sessionDir)
          : SessionManager.continueRecent(cwd, sessionDir),
    });

    const cached = { cwd, session, sessionDir };
    this.sessions.set(getScopeKey(scope), cached);

    return cached;
  }

  private async resolveSessionDir(scope: RuntimeScope, mode: "continue" | "new"): Promise<string> {
    const scopedSessionDir = getSessionDirectoryForScope(this.config.baseDir, scope);
    if (mode === "continue" && scope.agentId === this.config.defaultAgent) {
      const legacySessionDir = getSessionDirectoryForThread(this.config.baseDir, scope.threadKey);
      if (!(await pathExists(scopedSessionDir)) && (await pathExists(legacySessionDir))) {
        return legacySessionDir;
      }
    }
    return scopedSessionDir;
  }

  private getAgentProfileRoot(agentId: string): string {
    const agent = this.config.agents[agentId];
    if (!agent) {
      throw new Error(`Agent is not configured: ${agentId}`);
    }
    return agent.profileRoot;
  }

  private normalizeScope(input: RuntimeScopeInput): RuntimeScope {
    if (typeof input === "string") {
      return { agentId: this.config.defaultAgent, threadKey: input };
    }
    return input;
  }

  private async getOrCreateSession(scope: RuntimeScope, cwd: string): Promise<CachedSession> {
    const scopeKey = getScopeKey(scope);
    const existing = this.sessions.get(scopeKey);
    if (existing && existing.cwd === cwd) {
      return existing;
    }

    if (existing && existing.cwd !== cwd) {
      existing.session.dispose();
      this.sessions.delete(scopeKey);
    }

    return this.createSession(scope, cwd, "continue");
  }

  async newSession(scopeInput: RuntimeScopeInput, cwd: string): Promise<void> {
    const scope = this.normalizeScope(scopeInput);
    const scopeKey = getScopeKey(scope);
    const existing = this.sessions.get(scopeKey);
    if (existing) {
      existing.session.dispose();
      this.sessions.delete(scopeKey);
    }

    await this.createSession(scope, cwd, "new");
  }

  async listSessions(scopeInput: RuntimeScopeInput, cwd: string): Promise<SessionInfo[]> {
    const scope = this.normalizeScope(scopeInput);
    const sessionDir = getSessionDirectoryForScope(this.config.baseDir, scope);
    await mkdir(sessionDir, { recursive: true });
    return SessionManager.list(cwd, sessionDir);
  }

  async switchSession(
    scopeInput: RuntimeScopeInput,
    cwd: string,
    sessionPath: string,
  ): Promise<boolean> {
    const scope = this.normalizeScope(scopeInput);
    const { session } = await this.getOrCreateSession(scope, cwd);
    return session.switchSession(sessionPath);
  }

  isRunning(scopeInput: RuntimeScopeInput): boolean {
    return this.inflight.has(getScopeKey(this.normalizeScope(scopeInput)));
  }

  /**
   * Inject a message into an already-running session (used for mid-turn
   * steering). Returns once the message has been queued into the session; the
   * inflight prompt's final reply is delivered by the original `prompt()`
   * caller, so this method deliberately does not await or return it to avoid
   * double-sending the same output to the user.
   */
  async steer(scopeInput: RuntimeScopeInput, text: string, images?: PiImageInput[]): Promise<void> {
    const scope = this.normalizeScope(scopeInput);
    const scopeKey = getScopeKey(scope);
    const cached = this.sessions.get(scopeKey);
    if (!cached) {
      throw new Error(`No active session for scope: ${scope.agentId}/${scope.threadKey}`);
    }
    if (!this.inflight.has(scopeKey)) {
      throw new Error(`No inflight prompt for scope: ${scope.agentId}/${scope.threadKey}`);
    }
    await cached.session.steer(text, images);
  }

  /**
   * Execute a prompt and register it in `inflight` *before* starting so that
   * concurrent `steer()` calls can discover and await it. The entry is removed
   * in a `finally` block regardless of outcome.
   */
  async prompt(
    scopeInput: RuntimeScopeInput,
    text: string,
    cwd: string,
    callbacks: PiPromptCallbacks = {},
  ): Promise<PiPromptResult> {
    const scope = this.normalizeScope(scopeInput);
    const scopeKey = getScopeKey(scope);
    const execution = this.runPrompt(scope, text, cwd, callbacks);
    this.inflight.set(scopeKey, execution);
    try {
      return await execution;
    } finally {
      this.inflight.delete(scopeKey);
    }
  }

  private async runPrompt(
    scope: RuntimeScope,
    text: string,
    cwd: string,
    callbacks: PiPromptCallbacks,
  ): Promise<PiPromptResult> {
    const { session } = await this.getOrCreateSession(scope, cwd);
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
  }
}
