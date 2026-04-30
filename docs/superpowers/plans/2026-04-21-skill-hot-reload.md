# Skill Hot Reload Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Goal: 让运行中的 shellRaining session 在 skill 文件新增、删除、修改后自动刷新 `<available_skills>`，并移除 shellRaining 自己那段重复的 skill 提示词。

Architecture: 在 `apps/agent` 中新增一个基于 chokidar 的 `SkillWatcher`，负责监听全局 skill 目录、agent skill 目录，以及每个 cwd 对应的 `.claude/skills` 目录。文件变化后先调用 `resourceLoader.reload()` 刷新 skill 元数据，再调用 `session.setActiveToolsByName(session.getActiveToolNames())` 触发系统提示词重建；同时清理 `packages/system-prompt` 中重复的 skills fragment，并更新对应测试。

Tech Stack: Node.js, TypeScript, Vitest, chokidar, pnpm workspace, Pi Coding Agent

---

## File Structure

- Modify `apps/agent/package.json`: 增加 `chokidar` 运行时依赖。
- Create `apps/agent/src/pi/skill-watcher.ts`: 封装目录监听、路径去重、防抖刷新、关闭 watcher。
- Modify `apps/agent/src/pi/runtime.ts`: 集成 `SkillWatcher`，为每个 session 注册 cwd 对应的 project skill 路径；skill 变更后刷新 `resourceLoader` 并重建系统提示词；新增 `dispose()`。
- Modify `apps/agent/src/index.ts`: 在进程退出时调用 `runtime.dispose()`，避免 watcher 泄漏。
- Modify `apps/agent/tests/pi-runtime.test.ts`: 覆盖 watcher 初始化、路径注册、reload + rebuild、dispose。
- Create `apps/agent/tests/skill-watcher.test.ts`: 覆盖去重、防抖、关闭行为。
- Modify `packages/system-prompt/src/build.ts`: 移除 `buildSkillsPrompt()` 调用。
- Delete `packages/system-prompt/src/fragments/skills.ts`: 删除冗余片段。
- Modify `packages/system-prompt/src/types.ts`: 删除 `skills` 字段。
- Modify `packages/system-prompt/tests/system-prompt.test.ts`: 更新上下文工厂与断言，去掉 skills 相关测试。

---

### Task 1: 清理重复的 shellRaining skills 提示词

Files:

- Modify: `packages/system-prompt/src/build.ts`
- Modify: `packages/system-prompt/src/types.ts`
- Modify: `packages/system-prompt/tests/system-prompt.test.ts`
- Delete: `packages/system-prompt/src/fragments/skills.ts`

- [ ] Step 1: 先写失败的 system-prompt 测试

把 `packages/system-prompt/tests/system-prompt.test.ts` 改成下面这样：

```ts
import { describe, expect, it } from "vitest";
import { buildShellRainingSystemPrompt } from "../src/index.js";
import type { SystemPromptContext } from "../src/index.js";

function createContext(): SystemPromptContext {
  return {
    environmentName: "shellRaining",
    telegram: {
      inboxDir: "~/.shellRaining/inbox/",
      outputStyle: "chat",
    },
  };
}

describe("system-prompt", () => {
  it("renders Telegram input and output guidance", () => {
    const result = buildShellRainingSystemPrompt(createContext());

    expect(result).toContain("[Telegram attachments]");
    expect(result).toContain("Do not claim you read an attachment before reading it");
    expect(result).toContain("~/.shellRaining/inbox/");
    expect(result).toContain("Telegram output is a chat surface");
    expect(result).toContain("Avoid Markdown tables in Telegram replies");
    expect(result).toContain("do not intentionally split a sentence");
  });

  it("does not render shellRaining-specific skills guidance", () => {
    const result = buildShellRainingSystemPrompt(createContext());

    expect(result).not.toContain("## Skills");
    expect(result).not.toContain("Pi may append an <available_skills> catalog later");
    expect(result).not.toContain("read that skill's SKILL.md with the read tool");
  });
});
```

- [ ] Step 2: 运行测试，确认当前会失败

Run:

```bash
pnpm --filter @shellraining/system-prompt test packages/system-prompt/tests/system-prompt.test.ts
```

Expected: FAIL，因为 `build.ts` 仍然拼接了 `buildSkillsPrompt()`，`SystemPromptContext` 仍然要求 `skills` 字段。

- [ ] Step 3: 做最小实现，删除重复片段

把 `packages/system-prompt/src/build.ts` 改成：

```ts
import { buildEnvironmentPrompt } from "./fragments/environment.js";
import { buildTelegramInputPrompt } from "./fragments/telegram-input.js";
import { buildTelegramOutputPrompt } from "./fragments/telegram-output.js";
import type { SystemPromptContext } from "./types.js";

export function buildShellRainingSystemPrompt(context: SystemPromptContext): string {
  return [
    buildEnvironmentPrompt(context),
    buildTelegramInputPrompt(context),
    buildTelegramOutputPrompt(context),
  ]
    .filter(Boolean)
    .join("\n");
}
```

把 `packages/system-prompt/src/types.ts` 改成：

```ts
export interface SystemPromptContext {
  environmentName: string;
  telegram: {
    inboxDir: string;
    outputStyle: "chat";
  };
}
```

删除文件：

```text
packages/system-prompt/src/fragments/skills.ts
```

- [ ] Step 4: 重新运行测试，确认通过

Run:

```bash
pnpm --filter @shellraining/system-prompt test packages/system-prompt/tests/system-prompt.test.ts
```

Expected: PASS，且输出中不再包含 shellRaining 自己拼出来的 Skills 段落。

- [ ] Step 5: Commit

```bash
git add packages/system-prompt/src/build.ts packages/system-prompt/src/types.ts packages/system-prompt/tests/system-prompt.test.ts packages/system-prompt/src/fragments/skills.ts
git commit -m "refactor: remove redundant skills prompt fragment"
```

---

### Task 2: 为 SkillWatcher 建立独立的可测试边界

Files:

- Modify: `apps/agent/package.json`
- Create: `apps/agent/src/pi/skill-watcher.ts`
- Create: `apps/agent/tests/skill-watcher.test.ts`

- [ ] Step 1: 先写失败的 SkillWatcher 测试

新建 `apps/agent/tests/skill-watcher.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn();
const close = vi.fn(async () => undefined);
const on = vi.fn();
const watchedPaths: string[] = [];

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn((paths: string | string[]) => {
      watchedPaths.push(...(Array.isArray(paths) ? paths : [paths]));
      return { add, close, on };
    }),
  },
}));

describe("SkillWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    watchedPaths.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates watched paths", async () => {
    const onReload = vi.fn(async () => undefined);
    const { SkillWatcher } = await import("../src/pi/skill-watcher.js");
    const watcher = new SkillWatcher({
      paths: ["/skills/global"],
      debounceMs: 500,
      onReload,
    });

    await watcher.addPath("/skills/global");
    await watcher.addPath("/skills/project");

    expect(watchedPaths).toEqual(["/skills/global"]);
    expect(add).toHaveBeenCalledWith("/skills/project");
  });

  it("debounces repeated file events into one reload", async () => {
    const handlers = new Map<string, (path: string) => void>();
    on.mockImplementation((event, handler) => {
      handlers.set(event, handler);
      return { add, close, on };
    });
    const onReload = vi.fn(async () => undefined);
    const { SkillWatcher } = await import("../src/pi/skill-watcher.js");
    new SkillWatcher({
      paths: ["/skills/global"],
      debounceMs: 500,
      onReload,
    });

    handlers.get("add")?.("/skills/a/SKILL.md");
    handlers.get("change")?.("/skills/a/SKILL.md");
    handlers.get("unlink")?.("/skills/a/SKILL.md");

    await vi.advanceTimersByTimeAsync(499);
    expect(onReload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("closes the underlying chokidar watcher", async () => {
    const { SkillWatcher } = await import("../src/pi/skill-watcher.js");
    const watcher = new SkillWatcher({
      paths: ["/skills/global"],
      debounceMs: 500,
      onReload: async () => undefined,
    });

    await watcher.dispose();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Step 2: 运行测试，确认失败

Run:

```bash
pnpm --filter @shellraining/agent test apps/agent/tests/skill-watcher.test.ts
```

Expected: FAIL，因为 `skill-watcher.ts` 还不存在，`chokidar` 依赖也还没安装。

- [ ] Step 3: 增加 chokidar 依赖并实现 SkillWatcher

把 `apps/agent/package.json` 的 dependencies 改成至少包含这一项：

```json
{
  "dependencies": {
    "@chat-adapter/state-memory": "^4.26.0",
    "@chat-adapter/telegram": "npm:@shellraining/chat-adapter-telegram@4.24.0",
    "@hono/node-server": "^1.14.1",
    "@mariozechner/pi-coding-agent": "^0.62.0",
    "@shellraining/system-prompt": "workspace:*",
    "@sinclair/typebox": "^0.34.41",
    "chat": "^4.26.0",
    "chokidar": "^4.0.3",
    "croner": "^9.1.0",
    "dotenv": "^16.6.1",
    "hono": "^4.12.5",
    "luxon": "^3.7.2",
    "nanoid": "^5.1.5",
    "undici": "^7.16.0"
  }
}
```

新建 `apps/agent/src/pi/skill-watcher.ts`：

```ts
import chokidar, { type FSWatcher } from "chokidar";

interface SkillWatcherOptions {
  paths: string[];
  debounceMs: number;
  onReload: () => Promise<void>;
}

export class SkillWatcher {
  private readonly watcher: FSWatcher;
  private readonly watchedPaths = new Set<string>();
  private reloadTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: SkillWatcherOptions) {
    this.watchedPaths = new Set(options.paths);
    this.watcher = chokidar.watch([...this.watchedPaths], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("add", () => this.scheduleReload());
    this.watcher.on("change", () => this.scheduleReload());
    this.watcher.on("unlink", () => this.scheduleReload());
    this.watcher.on("error", (error) => {
      console.error("[skill-watcher] watcher error", error);
    });
  }

  async addPath(path: string): Promise<void> {
    if (this.watchedPaths.has(path)) {
      return;
    }

    this.watchedPaths.add(path);
    await this.watcher.add(path);
  }

  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }

    this.reloadTimer = setTimeout(() => {
      void this.options.onReload().catch((error) => {
        console.error("[skill-watcher] reload failed", error);
      });
    }, this.options.debounceMs);
  }

  async dispose(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    await this.watcher.close();
  }
}
```

- [ ] Step 4: 重新运行测试，确认通过

Run:

```bash
pnpm install
pnpm --filter @shellraining/agent test apps/agent/tests/skill-watcher.test.ts
```

Expected: PASS，证明 watcher 的去重、防抖、关闭逻辑成立。

- [ ] Step 5: Commit

```bash
git add apps/agent/package.json pnpm-lock.yaml apps/agent/src/pi/skill-watcher.ts apps/agent/tests/skill-watcher.test.ts
git commit -m "feat: add debounced skill watcher"
```

---

### Task 3: 在 PiRuntime 中接入热更新与系统提示词重建

Files:

- Modify: `apps/agent/src/pi/runtime.ts`
- Modify: `apps/agent/tests/pi-runtime.test.ts`

- [ ] Step 1: 先写失败的 PiRuntime 测试

把 `apps/agent/tests/pi-runtime.test.ts` 顶部 mock 扩展成下面这样：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionListener = (event: unknown) => void;

const sessionPrompt = vi.fn();
const sessionSubscribe = vi.fn((_listener: SessionListener) => () => undefined);
const sessionDispose = vi.fn();
const sessionNewSession = vi.fn();
const sessionGetActiveToolNames = vi.fn(() => ["read", "bash"]);
const sessionSetActiveToolsByName = vi.fn(async () => undefined);
const sessionManagerContinueRecent = vi.fn(() => ({ mode: "recent" }));
const sessionManagerCreate = vi.fn(() => ({ mode: "new" }));
const resourceLoaderReload = vi.fn(async () => undefined);
const defaultResourceLoader = vi.fn(function DefaultResourceLoaderMock() {
  return {
    reload: resourceLoaderReload,
  };
});
const skillWatcherAddPath = vi.fn(async () => undefined);
const skillWatcherDispose = vi.fn(async () => undefined);
const skillWatcherCtor = vi.fn(function SkillWatcherMock() {
  return {
    addPath: skillWatcherAddPath,
    dispose: skillWatcherDispose,
  };
});
```

把 `@mariozechner/pi-coding-agent` mock 中的 session 改成：

```ts
session: {
  dispose: sessionDispose,
  getActiveToolNames: sessionGetActiveToolNames,
  listSessions: vi.fn(),
  newSession: sessionNewSession,
  prompt: sessionPrompt,
  setActiveToolsByName: sessionSetActiveToolsByName,
  subscribe: sessionSubscribe,
  switchSession: vi.fn(),
},
```

新增 `SkillWatcher` mock：

```ts
vi.mock("../src/pi/skill-watcher.js", () => ({
  SkillWatcher: skillWatcherCtor,
}));
```

再新增这三个测试：

```ts
it("registers all skill directories when creating a session", async () => {
  const { PiRuntime } = await import("../src/pi/runtime.js");
  const runtime = new PiRuntime(createRuntimeConfig());

  await runtime.prompt("telegram__1", "hello", "/mock/workspace");

  expect(skillWatcherCtor).toHaveBeenCalledWith(
    expect.objectContaining({
      paths: ["/mock/skills", "/mock/agent/skills", "/mock/workspace/.claude/skills"],
      debounceMs: 500,
    }),
  );
});

it("reloads the resource loader and rebuilds the system prompt after skill changes", async () => {
  const { PiRuntime } = await import("../src/pi/runtime.js");
  const runtime = new PiRuntime(createRuntimeConfig());

  await runtime.prompt("telegram__1", "hello", "/mock/workspace");

  const options = skillWatcherCtor.mock.calls.at(0)?.at(0) as { onReload: () => Promise<void> };
  await options.onReload();

  expect(resourceLoaderReload).toHaveBeenCalledTimes(2);
  expect(sessionGetActiveToolNames).toHaveBeenCalledTimes(1);
  expect(sessionSetActiveToolsByName).toHaveBeenCalledWith(["read", "bash"]);
});

it("disposes sessions and the skill watcher", async () => {
  const { PiRuntime } = await import("../src/pi/runtime.js");
  const runtime = new PiRuntime(createRuntimeConfig());

  await runtime.prompt("telegram__1", "hello", "/mock/workspace");
  await runtime.dispose();

  expect(sessionDispose).toHaveBeenCalledTimes(1);
  expect(skillWatcherDispose).toHaveBeenCalledTimes(1);
});
```

同时把原来的 skills prompt 断言改成：

```ts
expect(result?.at(-1)).toContain("Telegram output is a chat surface");
expect(result?.at(-1)).not.toContain("Pi may append an <available_skills> catalog later");
```

- [ ] Step 2: 运行测试，确认失败

Run:

```bash
pnpm --filter @shellraining/agent test apps/agent/tests/pi-runtime.test.ts
```

Expected: FAIL，因为 `PiRuntime` 还没有接入 `SkillWatcher`、没有 `dispose()`、也没有 reload 后重建系统提示词的逻辑。

- [ ] Step 3: 在 PiRuntime 中加入 watcher、reload 和 dispose

把 `apps/agent/src/pi/runtime.ts` 按下面的结构修改：

```ts
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
```

在类里新增字段：

```ts
  private skillWatcher: SkillWatcher | undefined;
```

新增私有方法：

```ts
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
          await session.setActiveToolsByName(session.getActiveToolNames());
        },
      });
      return;
    }

    await this.skillWatcher.addPath(projectSkillsDir);
  }
```

把 `appendSystemPromptOverride` 里的上下文改成：

```ts
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
```

在 `createSession()` 里创建 session 后立刻注册 watcher：

```ts
await this.ensureSkillWatcher(cwd, resourceLoader, session);
```

在类末尾新增：

```ts
  async dispose(): Promise<void> {
    for (const { session } of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    await this.skillWatcher?.dispose();
    this.skillWatcher = undefined;
  }
```

- [ ] Step 4: 重新运行测试，确认通过

Run:

```bash
pnpm --filter @shellraining/agent test apps/agent/tests/pi-runtime.test.ts
```

Expected: PASS，证明 session 创建时会注册 skill 路径，skill 变化时会先 reload 再 rebuild，runtime 销毁时会释放 watcher。

- [ ] Step 5: Commit

```bash
git add apps/agent/src/pi/runtime.ts apps/agent/tests/pi-runtime.test.ts
git commit -m "feat: hot reload skills in pi runtime"
```

---

### Task 4: 在应用入口接管 watcher 生命周期

Files:

- Modify: `apps/agent/src/index.ts`

- [ ] Step 1: 先补一个最小集成约束

把 `apps/agent/src/index.ts` 中 runtime 初始化后的代码阅读一遍，确认当前没有任何退出清理逻辑；本任务直接在入口接管 `SIGINT` 和 `SIGTERM`，不额外新增测试文件。

- [ ] Step 2: 实现优雅退出时的 runtime.dispose()

把 `apps/agent/src/index.ts` 在 `const botRuntime = createBot(config, runtime);` 之后、`await cronService.start();` 之前插入：

```ts
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`[shellRaining] shutting down on ${signal}`);
  await runtime.dispose();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
```

这样 `SkillWatcher` 不会在本地开发或部署重启时残留文件句柄。

- [ ] Step 3: 做最小验证

Run:

```bash
pnpm --filter @shellraining/agent typecheck
```

Expected: PASS，说明 `runtime.dispose()` 已被正确接线，入口文件没有类型错误。

- [ ] Step 4: Commit

```bash
git add apps/agent/src/index.ts
git commit -m "refactor: dispose runtime on shutdown"
```

---

### Task 5: 跑完整验证，确认热更新方案闭环

Files:

- Modify: `apps/agent/tests/pi-runtime.test.ts`
- Modify: `apps/agent/tests/skill-watcher.test.ts`
- Modify: `packages/system-prompt/tests/system-prompt.test.ts`

- [ ] Step 1: 运行包级测试

Run:

```bash
pnpm --filter @shellraining/system-prompt test packages/system-prompt/tests/system-prompt.test.ts
pnpm --filter @shellraining/agent test apps/agent/tests/skill-watcher.test.ts apps/agent/tests/pi-runtime.test.ts
```

Expected: PASS，三个测试文件全部通过。

- [ ] Step 2: 运行工作区类型检查

Run:

```bash
pnpm typecheck
```

Expected: PASS，`@shellraining/system-prompt` 与 `@shellraining/agent` 都通过。

- [ ] Step 3: 运行工作区完整测试

Run:

```bash
pnpm test
```

Expected: PASS，现有 agent 与 system-prompt 测试无回归。

- [ ] Step 4: 手工验证一次热更新链路

Run:

```bash
pnpm dev
```

然后在另一个终端中执行下面的手工检查：

```bash
printf '\n- 临时说明\n' >> "$HOME/Documents/dotfiles/skills/cron/SKILL.md"
```

Expected: 开发进程无崩溃，并打印一次类似 `[skill-watcher]` 的 reload 日志；下一轮同一 session 的 prompt 能看到更新后的 skill 元数据。

接着恢复文件：

```bash
git checkout -- "$HOME/Documents/dotfiles/skills/cron/SKILL.md"
```

如果该文件不在 git 仓库中，就手动删掉刚追加的那一行。

- [ ] Step 5: Commit

```bash
git add apps/agent/package.json pnpm-lock.yaml apps/agent/src/pi/skill-watcher.ts apps/agent/src/pi/runtime.ts apps/agent/src/index.ts apps/agent/tests/skill-watcher.test.ts apps/agent/tests/pi-runtime.test.ts packages/system-prompt/src/build.ts packages/system-prompt/src/types.ts packages/system-prompt/tests/system-prompt.test.ts packages/system-prompt/src/fragments/skills.ts
git commit -m "feat: hot reload skills"
```

---

## Self-review

- Spec coverage: 已覆盖 skill 文件新增/删除/修改触发刷新、`resourceLoader.reload()`、系统提示词重建、watcher 生命周期、冗余 prompt 清理，以及测试与手工验证。
- Placeholder scan: 没有保留 TBD、TODO、"自行处理"、"类似 Task N" 之类占位描述。
- Type consistency: 统一使用 `SkillWatcher`、`dispose()`、`getActiveToolNames()`、`setActiveToolsByName()`、`buildShellRainingSystemPrompt()` 这些名称；system-prompt 上下文已统一移除 `skills` 字段。
