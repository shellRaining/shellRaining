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
import { readConfig, type ConfigSource } from "../config.js";
import { buildShellRainingSystemPrompt } from "@shellraining/system-prompt";
import { ProfileWatcher } from "./profile-watcher.js";
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
  resourceLoader: DefaultResourceLoader;
  scope: RuntimeScope;
  sessionDir: string;
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  stale: boolean;
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
  private readonly profileWatchers = new Map<string, ProfileWatcher>();
  private readonly sessions = new Map<string, CachedSession>();
  private readonly pendingSessions = new Map<string, Promise<CachedSession>>();
  /** Tracks in-flight prompt executions per runtime scope for mid-session steering. */
  private readonly inflight = new Map<string, Promise<PiPromptResult>>();

  constructor(
    private readonly configSource: ConfigSource,
    private readonly options: PiRuntimeOptions = {},
  ) {}

  private get config() {
    return readConfig(this.configSource);
  }

  private async createSession(
    scope: RuntimeScope,
    cwd: string,
    mode: "continue" | "new",
  ): Promise<CachedSession> {
    const profileRoot = this.getAgentProfileRoot(scope.agentId);
    this.ensureProfileWatcher(scope.agentId);
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

    const cached = { cwd, resourceLoader, scope, session, sessionDir, stale: false };
    this.sessions.set(getScopeKey(scope), cached);

    return cached;
  }

  private async resolveSessionDir(scope: RuntimeScope, mode: "continue" | "new"): Promise<string> {
    const scopedSessionDir = getSessionDirectoryForScope(this.config.paths.baseDir, scope);
    if (mode === "continue" && scope.agentId === this.config.telegram.defaultAgent) {
      const legacySessionDir = getSessionDirectoryForThread(
        this.config.paths.baseDir,
        scope.threadKey,
      );
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

  private ensureProfileWatcher(agentId: string): void {
    const agent = this.config.agents[agentId];
    if (!agent || this.profileWatchers.has(agent.piProfile)) {
      return;
    }

    this.profileWatchers.set(
      agent.piProfile,
      new ProfileWatcher({
        debounceMs: 500,
        onAuthOrModelChange: (piProfile) => this.invalidateProfileSessions(piProfile),
        onResourceChange: (piProfile) => this.reloadProfileResources(piProfile),
        piProfile: agent.piProfile,
        profileRoot: agent.profileRoot,
      }),
    );
  }

  private getAgentIdsForProfile(piProfile: string): Set<string> {
    return new Set(
      Object.values(this.config.agents)
        .filter((agent) => agent.piProfile === piProfile)
        .map((agent) => agent.id),
    );
  }

  private normalizeScope(input: RuntimeScopeInput): RuntimeScope {
    if (typeof input === "string") {
      return { agentId: this.config.telegram.defaultAgent, threadKey: input };
    }
    return input;
  }

  private async getOrCreateSession(scope: RuntimeScope, cwd: string): Promise<CachedSession> {
    const scopeKey = getScopeKey(scope);
    const existing = this.sessions.get(scopeKey);
    if (existing?.stale && !this.inflight.has(scopeKey)) {
      existing.session.dispose();
      this.sessions.delete(scopeKey);
      return this.createSession(scope, cwd, "continue");
    }

    if (existing && existing.cwd === cwd) {
      return existing;
    }

    if (existing && existing.cwd !== cwd) {
      existing.session.dispose();
      this.sessions.delete(scopeKey);
    }

    return this.createSession(scope, cwd, "continue");
  }

  async reloadProfileResources(piProfile: string): Promise<void> {
    const agentIds = this.getAgentIdsForProfile(piProfile);
    for (const cached of this.sessions.values()) {
      if (!agentIds.has(cached.scope.agentId)) {
        continue;
      }
      const activeToolNames = cached.session.getActiveToolNames();
      await cached.resourceLoader.reload();
      cached.session.setActiveToolsByName(activeToolNames);
    }
  }

  async invalidateProfileSessions(piProfile: string): Promise<void> {
    const agentIds = this.getAgentIdsForProfile(piProfile);
    for (const [scopeKey, cached] of this.sessions) {
      if (!agentIds.has(cached.scope.agentId)) {
        continue;
      }
      if (this.inflight.has(scopeKey)) {
        cached.stale = true;
        continue;
      }
      cached.session.dispose();
      this.sessions.delete(scopeKey);
    }
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
    const sessionDir = getSessionDirectoryForScope(this.config.paths.baseDir, scope);
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
    if (!this.inflight.has(scopeKey)) {
      throw new Error(`No inflight prompt for scope: ${scope.agentId}/${scope.threadKey}`);
    }
    const cached = this.sessions.get(scopeKey) ?? (await this.pendingSessions.get(scopeKey));
    if (!cached) {
      throw new Error(`No active session for scope: ${scope.agentId}/${scope.threadKey}`);
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
    const session = this.getOrCreateSession(scope, cwd);
    this.pendingSessions.set(scopeKey, session);
    const execution = this.runPrompt(scope, session, text, callbacks);
    this.inflight.set(scopeKey, execution);
    try {
      return await execution;
    } finally {
      this.pendingSessions.delete(scopeKey);
      this.inflight.delete(scopeKey);
    }
  }

  private async runPrompt(
    scope: RuntimeScope,
    cachedSession: Promise<CachedSession>,
    text: string,
    callbacks: PiPromptCallbacks,
  ): Promise<PiPromptResult> {
    const { session } = await cachedSession;
    let output = "";
    let toolOutput = "";
    let assistantError: string | undefined;
    const showThinking = this.config.telegram.showThinking;

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      const eventError = getAssistantErrorMessage(event);
      if (eventError) {
        assistantError = eventError;
      }

      if (event.type === "message_update") {
        if (event.assistantMessageEvent.type === "text_delta") {
          output += event.assistantMessageEvent.delta;
        }
        if (showThinking && event.assistantMessageEvent.type === "thinking_delta") {
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
    for (const watcher of this.profileWatchers.values()) {
      await watcher.dispose();
    }
    this.profileWatchers.clear();
  }
}
