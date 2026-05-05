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
import { readConfig, type ConfigSource } from "../config/index.js";
import { getTelegramInboxDisplayPath } from "../config/path.js";
import { createNoopLogger, type Logger } from "../logging/service.js";
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
  logger?: Logger;
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

function getAssistantErrorMessage(event: AgentSessionEvent): string | undefined {
  if (event.type !== "message_end" && event.type !== "turn_end") {
    return undefined;
  }

  const message = event.message;
  if (
    !("role" in message) ||
    message.role !== "assistant" ||
    !("stopReason" in message) ||
    message.stopReason !== "error" ||
    !("errorMessage" in message) ||
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
  private readonly logger: Logger;

  constructor(
    private readonly configSource: ConfigSource,
    private readonly options: PiRuntimeOptions = {},
  ) {
    this.logger = (options.logger ?? createNoopLogger()).child({ component: "pi-runtime" });
  }

  private get config() {
    return readConfig(this.configSource);
  }

  private async createSession(
    scope: RuntimeScope,
    cwd: string,
    mode: "continue" | "new",
  ): Promise<CachedSession> {
    const startedAt = Date.now();
    this.logger.info(
      {
        agentId: scope.agentId,
        cwd,
        event: "session.create.start",
        mode,
        threadKey: scope.threadKey,
      },
      "Pi session creation started",
    );
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
            inboxDir: getTelegramInboxDisplayPath(),
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

    this.logger.info(
      {
        agentId: scope.agentId,
        durationMs: Date.now() - startedAt,
        event: "session.create.finish",
        mode,
        sessionDir,
        threadKey: scope.threadKey,
      },
      "Pi session creation finished",
    );

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
    if (agent === undefined) {
      throw new Error(`Agent is not configured: ${agentId}`);
    }
    return agent.profileRoot;
  }

  private ensureProfileWatcher(agentId: string): void {
    const agent = this.config.agents[agentId];
    if (agent === undefined || this.profileWatchers.has(agent.piProfile)) {
      return;
    }

    this.profileWatchers.set(
      agent.piProfile,
      new ProfileWatcher({
        debounceMs: 500,
        onAuthOrModelChange: async (piProfile) => {
          await this.invalidateProfileSessions(piProfile);
        },
        onResourceChange: (piProfile) => this.reloadProfileResources(piProfile),
        logger: this.logger,
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

  private getOrCreateSession(scope: RuntimeScope, cwd: string): Promise<CachedSession> {
    const scopeKey = getScopeKey(scope);
    const existing = this.sessions.get(scopeKey);
    if (existing?.stale === true && !this.inflight.has(scopeKey)) {
      this.logger.info(
        {
          agentId: scope.agentId,
          event: "session.cache.stale_disposed",
          threadKey: scope.threadKey,
        },
        "disposing stale Pi session",
      );
      existing.session.dispose();
      this.sessions.delete(scopeKey);
      return this.createSession(scope, cwd, "continue");
    }

    if (existing !== undefined && existing.cwd === cwd) {
      this.logger.debug(
        { agentId: scope.agentId, event: "session.cache.hit", threadKey: scope.threadKey },
        "using cached Pi session",
      );
      return Promise.resolve(existing);
    }

    if (existing !== undefined && existing.cwd !== cwd) {
      this.logger.info(
        { agentId: scope.agentId, event: "session.cache.cwd_changed", threadKey: scope.threadKey },
        "recreating Pi session for changed cwd",
      );
      existing.session.dispose();
      this.sessions.delete(scopeKey);
    }

    return this.createSession(scope, cwd, "continue");
  }

  async reloadProfileResources(piProfile: string): Promise<void> {
    const startedAt = Date.now();
    this.logger.info(
      { event: "profile.resources.reload.start", piProfile },
      "profile resource reload started",
    );
    const agentIds = this.getAgentIdsForProfile(piProfile);
    for (const cached of this.sessions.values()) {
      if (!agentIds.has(cached.scope.agentId)) {
        continue;
      }
      const activeToolNames = cached.session.getActiveToolNames();
      await cached.resourceLoader.reload();
      cached.session.setActiveToolsByName(activeToolNames);
    }
    this.logger.info(
      { durationMs: Date.now() - startedAt, event: "profile.resources.reload.finish", piProfile },
      "profile resource reload finished",
    );
  }

  async invalidateProfileSessions(piProfile: string): Promise<void> {
    await Promise.resolve();
    this.logger.info(
      { event: "profile.sessions.invalidate.start", piProfile },
      "profile session invalidation started",
    );
    const agentIds = this.getAgentIdsForProfile(piProfile);
    for (const [scopeKey, cached] of this.sessions) {
      if (!agentIds.has(cached.scope.agentId)) {
        continue;
      }
      if (this.inflight.has(scopeKey)) {
        cached.stale = true;
        this.logger.info(
          {
            agentId: cached.scope.agentId,
            event: "profile.sessions.invalidate.defer_inflight",
            piProfile,
            threadKey: cached.scope.threadKey,
          },
          "profile session invalidation deferred for inflight prompt",
        );
        continue;
      }
      cached.session.dispose();
      this.sessions.delete(scopeKey);
    }
    this.logger.info(
      { event: "profile.sessions.invalidate.finish", piProfile },
      "profile session invalidation finished",
    );
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
    this.logger.info(
      { agentId: scope.agentId, cwd, event: "session.new", threadKey: scope.threadKey },
      "new Pi session started",
    );
  }

  async listSessions(scopeInput: RuntimeScopeInput, cwd: string): Promise<SessionInfo[]> {
    const scope = this.normalizeScope(scopeInput);
    const sessionDir = getSessionDirectoryForScope(this.config.paths.baseDir, scope);
    await mkdir(sessionDir, { recursive: true });
    this.logger.info(
      {
        agentId: scope.agentId,
        cwd,
        event: "session.list",
        sessionDir,
        threadKey: scope.threadKey,
      },
      "listing Pi sessions",
    );
    return SessionManager.list(cwd, sessionDir);
  }

  async switchSession(
    scopeInput: RuntimeScopeInput,
    cwd: string,
    sessionPath: string,
  ): Promise<boolean> {
    const scope = this.normalizeScope(scopeInput);
    const { session } = await this.getOrCreateSession(scope, cwd);
    const switched = session.switchSession(sessionPath);
    this.logger.info(
      {
        agentId: scope.agentId,
        cwd,
        event: "session.switch",
        sessionPath,
        switched,
        threadKey: scope.threadKey,
      },
      "switching Pi session",
    );
    return switched;
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
      this.logger.warn(
        { agentId: scope.agentId, event: "steer.error.no_inflight", threadKey: scope.threadKey },
        "no inflight prompt for steering",
      );
      throw new Error(`No inflight prompt for scope: ${scope.agentId}/${scope.threadKey}`);
    }
    const cached = this.sessions.get(scopeKey) ?? (await this.pendingSessions.get(scopeKey));
    if (!cached) {
      this.logger.warn(
        {
          agentId: scope.agentId,
          event: "steer.error.no_active_session",
          threadKey: scope.threadKey,
        },
        "no active Pi session for steering",
      );
      throw new Error(`No active session for scope: ${scope.agentId}/${scope.threadKey}`);
    }
    this.logger.info(
      {
        agentId: scope.agentId,
        event: "steer.accepted",
        hasImages: (images?.length ?? 0) > 0,
        imageCount: images?.length ?? 0,
        promptLength: text.length,
        threadKey: scope.threadKey,
      },
      "steer message accepted",
    );
    await cached.session.steer(text, images);
    this.logger.info(
      { agentId: scope.agentId, event: "steer.finish", threadKey: scope.threadKey },
      "steer message queued",
    );
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
    this.logger.info(
      {
        agentId: scope.agentId,
        cwd,
        event: "prompt.accepted",
        hasImages: (callbacks.images?.length ?? 0) > 0,
        imageCount: callbacks.images?.length ?? 0,
        promptLength: text.length,
        threadKey: scope.threadKey,
      },
      "prompt accepted",
    );
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
    const startedAt = Date.now();
    const { session } = await cachedSession;
    let output = "";
    let toolOutput = "";
    let assistantError: string | undefined;
    const showThinking = this.config.telegram.showThinking;

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      const eventError = getAssistantErrorMessage(event);
      if (eventError !== undefined) {
        assistantError = eventError;
        this.logger.error(
          { agentId: scope.agentId, event: "prompt.assistant_error", threadKey: scope.threadKey },
          "assistant emitted an error stop reason",
        );
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
        this.logger.info(
          {
            agentId: scope.agentId,
            event: "agent.tool.start",
            threadKey: scope.threadKey,
            toolName: event.toolName,
          },
          "agent tool execution started",
        );
        void callbacks.onStatus?.(`正在执行 ${event.toolName}`);
      }

      if (event.type === "tool_execution_update") {
        const partialType = typeof event.partialResult;
        const partialLength =
          typeof event.partialResult === "string"
            ? event.partialResult.length
            : event.partialResult === undefined
              ? 0
              : JSON.stringify(event.partialResult).length;
        this.logger.debug(
          {
            agentId: scope.agentId,
            event: "agent.tool.update",
            partialLength,
            partialType,
            threadKey: scope.threadKey,
          },
          "agent tool execution updated",
        );
        if (typeof event.partialResult === "string") {
          toolOutput += event.partialResult;
        } else if (event.partialResult !== undefined) {
          toolOutput += JSON.stringify(event.partialResult);
        }
      }

      if (event.type === "agent_start") {
        this.logger.info(
          { agentId: scope.agentId, event: "agent.start", threadKey: scope.threadKey },
          "agent started thinking",
        );
        void callbacks.onStatus?.("正在思考...");
      }
    });

    try {
      this.logger.info(
        {
          agentId: scope.agentId,
          event: "prompt.start",
          hasImages: (callbacks.images?.length ?? 0) > 0,
          imageCount: callbacks.images?.length ?? 0,
          promptLength: text.length,
          threadKey: scope.threadKey,
        },
        "prompt started",
      );
      await session.prompt(
        text,
        callbacks.images !== undefined && callbacks.images.length > 0
          ? { images: callbacks.images }
          : undefined,
      );
      const artifactsOutput = `${output}\n${toolOutput}`.trim();
      if (assistantError !== undefined) {
        this.logger.error(
          {
            agentId: scope.agentId,
            artifactOutputLength: artifactsOutput.length,
            durationMs: Date.now() - startedAt,
            event: "prompt.error",
            textLength: output.length,
            threadKey: scope.threadKey,
            toolOutputLength: toolOutput.length,
          },
          "prompt finished with assistant error",
        );
        return {
          artifactsOutput,
          error: assistantError,
          text: output,
        };
      }

      this.logger.info(
        {
          agentId: scope.agentId,
          artifactOutputLength: artifactsOutput.length,
          durationMs: Date.now() - startedAt,
          event: "prompt.finish",
          textLength: output.length,
          threadKey: scope.threadKey,
          toolOutputLength: toolOutput.length,
        },
        "prompt finished",
      );
      return {
        artifactsOutput,
        text: output || "(no output)",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        {
          agentId: scope.agentId,
          durationMs: Date.now() - startedAt,
          error,
          event: "prompt.error",
          textLength: output.length,
          threadKey: scope.threadKey,
          toolOutputLength: toolOutput.length,
        },
        "prompt failed",
      );
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
    this.logger.info(
      { event: "runtime.dispose.start", sessionCount: this.sessions.size },
      "Pi runtime dispose started",
    );
    for (const { session } of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    for (const watcher of this.profileWatchers.values()) {
      await watcher.dispose();
    }
    this.profileWatchers.clear();
    this.logger.info({ event: "runtime.dispose.finish" }, "Pi runtime dispose finished");
  }
}
