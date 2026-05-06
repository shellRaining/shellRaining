# Agent Persona System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the shellRaining system prompt builder into `apps/agent`, then add per-Agent persona files (`IDENTITY.md`, `SOUL.md`, `USER.md`) that are read by the runtime and injected into the system prompt before the first reply.

**Architecture:** `apps/agent` owns Agent/runtime concepts, filesystem reads, hot reload, and prompt assembly. The former `packages/system-prompt` code becomes `apps/agent/src/system-prompt`, so `runtime.ts` calls one app-local builder that combines environment, Telegram rules, and Agent persona context. Persona files live at `<baseDir>/agents/<agentId>/` and are injected as system prompt text, not as paths for the model to read later.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Vitest, Pi SDK `DefaultResourceLoader`, chokidar.

---

## File Structure

- Move: `packages/system-prompt/src/**` -> `apps/agent/src/system-prompt/**`
- Move: `packages/system-prompt/tests/system-prompt.test.ts` -> `apps/agent/tests/system-prompt.test.ts`
- Modify: `apps/agent/src/pi/runtime.ts`
- Modify: `apps/agent/src/pi/profile-watcher.ts`
- Modify: `apps/agent/src/config/schema.ts`
- Modify: `apps/agent/src/config/agents.ts`
- Modify: `apps/agent/package.json`
- Modify: `pnpm-lock.yaml`
- Delete: `packages/system-prompt/package.json`
- Delete: `packages/system-prompt/tsconfig.json`
- Delete: `packages/system-prompt/src/**`
- Delete: `packages/system-prompt/tests/system-prompt.test.ts`
- Create: `apps/agent/src/pi/persona-files.ts`
- Create: `apps/agent/src/pi/persona-files.test-support.ts` only if tests need shared fixtures; prefer keeping fixtures inside tests first.
- Create: `apps/agent/tests/persona-files.test.ts`

`apps/agent/src/system-prompt` owns pure prompt rendering. It must not read the filesystem or know chokidar.

`apps/agent/src/pi/persona-files.ts` owns Agent persona file discovery, boundary-safe reads, size limits, ordering, and prompt section rendering.

`apps/agent/src/pi/runtime.ts` owns when persona files are loaded and when resource loaders reload after persona changes.

`apps/agent/src/pi/profile-watcher.ts` owns file watching. It will watch Pi profile resources and additional per-Agent persona roots through explicit options.

---

### Task 1: Inline The System Prompt Package Into The Agent App

**Files:**
- Create: `apps/agent/src/system-prompt/build.ts`
- Create: `apps/agent/src/system-prompt/types.ts`
- Create: `apps/agent/src/system-prompt/index.ts`
- Create: `apps/agent/src/system-prompt/fragments/environment.ts`
- Create: `apps/agent/src/system-prompt/fragments/telegram-input.ts`
- Create: `apps/agent/src/system-prompt/fragments/telegram-output.ts`
- Move test: `packages/system-prompt/tests/system-prompt.test.ts` -> `apps/agent/tests/system-prompt.test.ts`
- Modify: `apps/agent/src/pi/runtime.ts`
- Modify: `apps/agent/package.json`

- [ ] **Step 1: Write the moved system prompt test**

Create `apps/agent/tests/system-prompt.test.ts` with the same assertions against the app-local module:

```ts
import { describe, expect, it } from "vitest";
import { buildShellRainingSystemPrompt } from "../src/system-prompt/index.js";
import type { SystemPromptContext } from "../src/system-prompt/index.js";

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

- [ ] **Step 2: Run the moved test and verify it fails**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/system-prompt.test.ts`

Expected: FAIL because `../src/system-prompt/index.js` does not exist yet.

- [ ] **Step 3: Create app-local system prompt modules**

Create `apps/agent/src/system-prompt/types.ts`:

```ts
export interface SystemPromptContext {
  environmentName: string;
  telegram: {
    inboxDir: string;
    outputStyle: "chat";
  };
  extraSections?: string[];
}
```

Create `apps/agent/src/system-prompt/fragments/environment.ts`:

```ts
import type { SystemPromptContext } from "../types.js";

export function buildEnvironmentPrompt(context: SystemPromptContext): string {
  return `You are running inside ${context.environmentName}'s personal environment.`;
}
```

Create `apps/agent/src/system-prompt/fragments/telegram-input.ts`:

```ts
import type { SystemPromptContext } from "../types.js";

export function buildTelegramInputPrompt(context: SystemPromptContext): string {
  return [
    `Telegram input attachments are saved locally under ${context.telegram.inboxDir} and are referenced with absolute paths.`,
    "When the user sends [Telegram attachments], inspect the listed files only when needed for the request.",
    "Do not claim you read an attachment before reading it.",
    "For PDFs, spreadsheets, office documents, archives, and other non-text files, use bash or existing tools to inspect or convert them as needed.",
  ].join("\n");
}
```

Create `apps/agent/src/system-prompt/fragments/telegram-output.ts`:

```ts
import type { SystemPromptContext } from "../types.js";

export function buildTelegramOutputPrompt(context: SystemPromptContext): string {
  if (context.telegram.outputStyle !== "chat") {
    return "";
  }

  return [
    "Telegram output is a chat surface, not a long document viewer.",
    "Prefer concise replies when the user does not ask for a full report.",
    "For long reports, plans, diaries, or generated documents, write the content to a file when appropriate and send only a short summary plus the path.",
    "Avoid Markdown tables in Telegram replies. Prefer short paragraphs and bullet lists.",
    "Keep each reply block readable on its own; do not intentionally split a sentence, list item, or code block across chat messages.",
  ].join("\n");
}
```

Create `apps/agent/src/system-prompt/build.ts`:

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
    ...(context.extraSections ?? []),
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n");
}
```

Create `apps/agent/src/system-prompt/index.ts`:

```ts
export { buildShellRainingSystemPrompt } from "./build.js";
export type { SystemPromptContext } from "./types.js";
```

- [ ] **Step 4: Update runtime import to use app-local system prompt**

In `apps/agent/src/pi/runtime.ts`, replace:

```ts
import { buildShellRainingSystemPrompt } from "@shellraining/system-prompt";
```

with:

```ts
import { buildShellRainingSystemPrompt } from "../system-prompt/index.js";
```

- [ ] **Step 5: Remove agent dependency on the package**

In `apps/agent/package.json`, remove the dependency line:

```json
"@shellraining/system-prompt": "workspace:*",
```

Also change the `dev` script from:

```json
"dev": "pnpm --dir ../.. --filter @shellraining/system-prompt build && tsx watch src/index.ts"
```

to:

```json
"dev": "tsx watch src/index.ts"
```

- [ ] **Step 6: Run the system prompt test and verify it passes**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/system-prompt.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/agent/src/system-prompt apps/agent/tests/system-prompt.test.ts apps/agent/src/pi/runtime.ts apps/agent/package.json
git commit -m "refactor: move system prompt into agent app"
```

---

### Task 2: Remove The Obsolete Workspace Package

**Files:**
- Delete: `packages/system-prompt/package.json`
- Delete: `packages/system-prompt/tsconfig.json`
- Delete: `packages/system-prompt/src/build.ts`
- Delete: `packages/system-prompt/src/types.ts`
- Delete: `packages/system-prompt/src/index.ts`
- Delete: `packages/system-prompt/src/fragments/environment.ts`
- Delete: `packages/system-prompt/src/fragments/telegram-input.ts`
- Delete: `packages/system-prompt/src/fragments/telegram-output.ts`
- Delete: `packages/system-prompt/tests/system-prompt.test.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Verify no source imports remain**

Run: `rg "@shellraining/system-prompt|packages/system-prompt" .`

Expected: only lockfile or generated `dist` references may remain before deletion; no `apps/**/src` or `apps/**/tests` source imports should appear.

- [ ] **Step 2: Delete the package source and package files**

Delete these paths with `apply_patch` or another non-destructive file removal method:

```text
packages/system-prompt/package.json
packages/system-prompt/tsconfig.json
packages/system-prompt/src/build.ts
packages/system-prompt/src/types.ts
packages/system-prompt/src/index.ts
packages/system-prompt/src/fragments/environment.ts
packages/system-prompt/src/fragments/telegram-input.ts
packages/system-prompt/src/fragments/telegram-output.ts
packages/system-prompt/tests/system-prompt.test.ts
```

Do not delete `dist` or `node_modules` unless the user explicitly wants workspace cleanup. They are build artifacts and ignored operationally once the package has no `package.json`.

- [ ] **Step 3: Refresh lockfile**

Run: `pnpm install --lockfile-only`

Expected: completes successfully and removes the `@shellraining/system-prompt` workspace dependency edge from `pnpm-lock.yaml`.

- [ ] **Step 4: Run workspace package discovery checks**

Run: `pnpm -r --if-present build`

Expected: no package named `@shellraining/system-prompt` is built; `@shellraining/agent` still builds.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/system-prompt apps/agent/package.json pnpm-lock.yaml
git commit -m "chore: remove standalone system prompt package"
```

---

### Task 3: Add Derived Agent Persona Roots To Config

**Files:**
- Modify: `apps/agent/src/config/schema.ts`
- Modify: `apps/agent/src/config/agents.ts`
- Modify: `apps/agent/tests/config.test.ts`

- [ ] **Step 1: Write failing config tests for personaRoot**

Add these tests to `apps/agent/tests/config.test.ts` near the existing agent profile root tests:

```ts
it("derives a persona root for the default agent", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-"));
  const configPath = join(tempDir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      telegram: { botToken: "file-token" },
      paths: { baseDir: join(tempDir, "base") },
    }),
  );

  process.env.SHELL_RAINING_CONFIG = configPath;
  delete process.env.TELEGRAM_BOT_TOKEN;

  const { loadConfig } = await import("../src/config/index.js");
  const config = await loadConfig();

  expect(config.agents.default?.personaRoot).toBe(join(tempDir, "base", "agents", "default"));
});

it("derives persona roots by agent id, not shared Pi profile", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-"));
  const configPath = join(tempDir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      telegram: { botToken: "file-token", defaultAgent: "coder" },
      paths: { baseDir: join(tempDir, "base") },
      agents: {
        coder: { piProfile: "shared" },
        reviewer: { piProfile: "shared" },
      },
    }),
  );

  process.env.SHELL_RAINING_CONFIG = configPath;
  delete process.env.TELEGRAM_BOT_TOKEN;

  const { loadConfig } = await import("../src/config/index.js");
  const config = await loadConfig();

  expect(config.agents.coder?.profileRoot).toBe(join(tempDir, "base", "pi-profiles", "shared"));
  expect(config.agents.reviewer?.profileRoot).toBe(join(tempDir, "base", "pi-profiles", "shared"));
  expect(config.agents.coder?.personaRoot).toBe(join(tempDir, "base", "agents", "coder"));
  expect(config.agents.reviewer?.personaRoot).toBe(join(tempDir, "base", "agents", "reviewer"));
});
```

- [ ] **Step 2: Run config tests and verify they fail**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/config.test.ts`

Expected: FAIL with `personaRoot` missing from resolved agents.

- [ ] **Step 3: Add personaRoot to config types and resolver**

In `apps/agent/src/config/schema.ts`, update `ResolvedAgentConfig`:

```ts
export interface ResolvedAgentConfig {
  id: string;
  aliases: string[];
  displayName: string;
  piProfile: string;
  profileRoot: string;
  personaRoot: string;
}
```

In `apps/agent/src/config/agents.ts`, add a helper:

```ts
function getPersonaRoot(baseDir: string, agentId: string): string {
  return getProfileRoot(baseDir, "..").replace(/pi-profiles[\\/]\.\.$/, "agents");
}
```

Do not use the helper above if it feels clever during implementation. Prefer this clearer import and implementation:

```ts
import { join } from "node:path";
```

```ts
function getPersonaRoot(baseDir: string, agentId: string): string {
  return join(baseDir, "agents", agentId);
}
```

Then add `personaRoot` in both resolved agent branches:

```ts
personaRoot: getPersonaRoot(baseDir, "default"),
```

and:

```ts
personaRoot: getPersonaRoot(baseDir, agentId),
```

- [ ] **Step 4: Run config tests and verify they pass**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/agent/src/config/schema.ts apps/agent/src/config/agents.ts apps/agent/tests/config.test.ts
git commit -m "feat: derive per-agent persona roots"
```

---

### Task 4: Implement Persona File Loading And Prompt Rendering

**Files:**
- Create: `apps/agent/src/pi/persona-files.ts`
- Create: `apps/agent/tests/persona-files.test.ts`

- [ ] **Step 1: Write failing persona file tests**

Create `apps/agent/tests/persona-files.test.ts`:

```ts
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildAgentPersonaPrompt, loadAgentPersonaFiles } from "../src/pi/persona-files.js";

describe("persona files", () => {
  it("loads persona files in stable identity, soul, user order", async () => {
    const root = await mkdtemp(join(tmpdir(), "shellraining-persona-"));
    await writeFile(join(root, "USER.md"), "User prefs", "utf-8");
    await writeFile(join(root, "SOUL.md"), "Persona voice", "utf-8");
    await writeFile(join(root, "IDENTITY.md"), "Agent role", "utf-8");
    await writeFile(join(root, "README.md"), "Ignored", "utf-8");

    const files = await loadAgentPersonaFiles(root);

    expect(files.map((file) => file.name)).toEqual(["IDENTITY.md", "SOUL.md", "USER.md"]);
    expect(files.map((file) => file.content)).toEqual(["Agent role", "Persona voice", "User prefs"]);
  });

  it("returns no files when the persona root is missing", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "shellraining-persona-")), "missing");

    await expect(loadAgentPersonaFiles(root)).resolves.toEqual([]);
  });

  it("skips blank files", async () => {
    const root = await mkdtemp(join(tmpdir(), "shellraining-persona-"));
    await writeFile(join(root, "SOUL.md"), "   \n\n", "utf-8");

    await expect(loadAgentPersonaFiles(root)).resolves.toEqual([]);
  });

  it("rejects symlinked persona files", async () => {
    const root = await mkdtemp(join(tmpdir(), "shellraining-persona-"));
    const outside = await mkdtemp(join(tmpdir(), "shellraining-persona-outside-"));
    await writeFile(join(outside, "SOUL.md"), "outside", "utf-8");
    await symlink(join(outside, "SOUL.md"), join(root, "SOUL.md"));

    await expect(loadAgentPersonaFiles(root)).resolves.toEqual([]);
  });

  it("skips oversized files", async () => {
    const root = await mkdtemp(join(tmpdir(), "shellraining-persona-"));
    await writeFile(join(root, "SOUL.md"), "x".repeat(256 * 1024 + 1), "utf-8");

    await expect(loadAgentPersonaFiles(root)).resolves.toEqual([]);
  });

  it("renders persona files as a system prompt section", async () => {
    const prompt = buildAgentPersonaPrompt([
      { name: "IDENTITY.md", path: "/agent/IDENTITY.md", content: "Agent role" },
      { name: "SOUL.md", path: "/agent/SOUL.md", content: "Persona voice" },
      { name: "USER.md", path: "/agent/User.md", content: "User prefs" },
    ]);

    expect(prompt).toContain("# Agent Persona Context");
    expect(prompt).toContain("These files are already loaded into the system prompt");
    expect(prompt).toContain("If SOUL.md is present, embody its persona and tone");
    expect(prompt).toContain("## IDENTITY.md");
    expect(prompt).toContain("Agent role");
    expect(prompt).toContain("## SOUL.md");
    expect(prompt).toContain("Persona voice");
    expect(prompt).toContain("## USER.md");
    expect(prompt).toContain("User prefs");
  });

  it("renders an empty section when no files are loaded", () => {
    expect(buildAgentPersonaPrompt([])).toBe("");
  });
});
```

- [ ] **Step 2: Run persona tests and verify they fail**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/persona-files.test.ts`

Expected: FAIL because `persona-files.js` does not exist.

- [ ] **Step 3: Implement persona file loading and prompt rendering**

Create `apps/agent/src/pi/persona-files.ts`:

```ts
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

const PERSONA_FILE_NAMES = ["IDENTITY.md", "SOUL.md", "USER.md"] as const;
const MAX_PERSONA_FILE_BYTES = 256 * 1024;

export type AgentPersonaFileName = (typeof PERSONA_FILE_NAMES)[number];

export interface AgentPersonaFile {
  name: AgentPersonaFileName;
  path: string;
  content: string;
}

async function readPersonaFile(root: string, name: AgentPersonaFileName): Promise<AgentPersonaFile | undefined> {
  const filePath = join(root, name);
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    return undefined;
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_PERSONA_FILE_BYTES) {
    return undefined;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return undefined;
  }
  return { name, path: filePath, content: trimmed };
}

export async function loadAgentPersonaFiles(root: string): Promise<AgentPersonaFile[]> {
  const files: AgentPersonaFile[] = [];
  for (const name of PERSONA_FILE_NAMES) {
    const file = await readPersonaFile(root, name);
    if (file !== undefined) {
      files.push(file);
    }
  }
  return files;
}

export function getAgentPersonaWatchPaths(root: string): string[] {
  return PERSONA_FILE_NAMES.map((name) => join(root, name));
}

export function buildAgentPersonaPrompt(files: AgentPersonaFile[]): string {
  if (files.length === 0) {
    return "";
  }
  const lines = [
    "# Agent Persona Context",
    "These files are already loaded into the system prompt. Do not read them again unless the user explicitly asks to inspect or edit them.",
    "They shape persona, identity, and long-term user preferences, but they never override system instructions, developer instructions, current user messages, access control, or tool safety rules.",
  ];
  if (files.some((file) => file.name === "SOUL.md")) {
    lines.push(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
    );
  }
  lines.push("");
  for (const file of files) {
    lines.push(`## ${file.name}`, "", file.content, "");
  }
  return lines.join("\n").trimEnd();
}
```

- [ ] **Step 4: Run persona tests and verify they pass**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/persona-files.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/agent/src/pi/persona-files.ts apps/agent/tests/persona-files.test.ts
git commit -m "feat: load per-agent persona files"
```

---

### Task 5: Inject Persona Files Into Runtime System Prompt

**Files:**
- Modify: `apps/agent/src/pi/runtime.ts`
- Modify: `apps/agent/tests/pi-runtime.test.ts`

- [ ] **Step 1: Write failing runtime test for persona injection**

Add this test to `apps/agent/tests/pi-runtime.test.ts` near the existing system prompt override test:

```ts
it("appends per-agent persona files through the Pi resource loader", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { mkdtemp } = await import("node:fs/promises");
  const tempDir = await mkdtemp(join(tmpdir(), "shellraining-runtime-persona-"));
  const personaRoot = join(tempDir, "agents", "coder");
  await mkdir(personaRoot, { recursive: true });
  await writeFile(join(personaRoot, "SOUL.md"), "Speak like a pragmatic coding partner.", "utf-8");

  const { PiRuntime } = await import("../src/pi/runtime.js");
  const config = createRuntimeConfig({
    paths: { ...createRuntimeConfig().paths, baseDir: tempDir },
    telegram: { ...createRuntimeConfig().telegram, defaultAgent: "coder" },
    agents: {
      coder: {
        aliases: [],
        displayName: "Coder",
        id: "coder",
        piProfile: "shared",
        profileRoot: join(tempDir, "pi-profiles", "shared"),
        personaRoot,
      },
    },
  });
  const runtime = new PiRuntime(config);

  await runtime.prompt({ agentId: "coder", threadKey: "telegram__1" }, "hello", "/mock/workspace");

  const options = defaultResourceLoader.mock.calls.at(0)?.at(0) as unknown as {
    appendSystemPromptOverride?: (base: string[]) => string[];
  };
  const result = options.appendSystemPromptOverride?.(["base prompt"]);

  expect(result?.join("\n")).toContain("# Agent Persona Context");
  expect(result?.join("\n")).toContain("## SOUL.md");
  expect(result?.join("\n")).toContain("Speak like a pragmatic coding partner.");
});
```

If `createRuntimeConfig` does not accept overrides, adjust it first with this helper pattern inside the test file:

```ts
function createRuntimeConfig(overrides: Partial<Config> = {}): Config {
  const base = originalCreateRuntimeConfig();
  return {
    ...base,
    ...overrides,
    paths: { ...base.paths, ...overrides.paths },
    telegram: { ...base.telegram, ...overrides.telegram },
    agents: overrides.agents ?? base.agents,
  };
}
```

Use the real existing helper name in the file; do not create duplicate helpers with the same name.

- [ ] **Step 2: Run runtime test and verify it fails**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/pi-runtime.test.ts`

Expected: FAIL because runtime does not load persona files yet.

- [ ] **Step 3: Load persona files during session creation**

In `apps/agent/src/pi/runtime.ts`, add imports:

```ts
import { buildAgentPersonaPrompt, loadAgentPersonaFiles } from "./persona-files.js";
```

In `createSession`, after resolving `profileRoot`, resolve the full agent config and load persona files:

```ts
const agent = this.getAgentConfig(scope.agentId);
const profileRoot = agent.profileRoot;
const personaFiles = await loadAgentPersonaFiles(agent.personaRoot);
const personaPrompt = buildAgentPersonaPrompt(personaFiles);
```

Replace existing `getAgentProfileRoot` usage with `getAgentConfig`. Add this method:

```ts
private getAgentConfig(agentId: string): ResolvedAgentConfig {
  const agent = this.config.agents[agentId];
  if (agent === undefined) {
    throw new Error(`Agent is not configured: ${agentId}`);
  }
  return agent;
}
```

Import `ResolvedAgentConfig` from config schema if needed:

```ts
import type { ResolvedAgentConfig } from "../config/schema.js";
```

Change `appendSystemPromptOverride` to pass the prompt through `extraSections`:

```ts
appendSystemPromptOverride: (base) => [
  ...base,
  buildShellRainingSystemPrompt({
    environmentName: "shellRaining",
    telegram: {
      inboxDir: getTelegramInboxDisplayPath(),
      outputStyle: "chat",
    },
    extraSections: [personaPrompt],
  }),
],
```

The `buildShellRainingSystemPrompt` filter will drop an empty persona prompt.

- [ ] **Step 4: Run runtime test and verify it passes**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/pi-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/agent/src/pi/runtime.ts apps/agent/tests/pi-runtime.test.ts
git commit -m "feat: inject agent persona into system prompt"
```

---

### Task 6: Watch Persona Files And Reload Existing Sessions

**Files:**
- Modify: `apps/agent/src/pi/profile-watcher.ts`
- Modify: `apps/agent/src/pi/runtime.ts`
- Modify: `apps/agent/tests/profile-watcher.test.ts`
- Modify: `apps/agent/tests/pi-runtime.test.ts`

- [ ] **Step 1: Write failing watcher test for extra watched paths**

Add a test in `apps/agent/tests/profile-watcher.test.ts` that verifies the watcher includes persona file paths. Use the existing chokidar mock pattern in that file. The assertion should check that `chokidar.watch` receives paths ending in:

```text
agents/coder/IDENTITY.md
agents/coder/SOUL.md
agents/coder/USER.md
```

The construction should look like:

```ts
new ProfileWatcher({
  debounceMs: 10,
  logger: createNoopLogger(),
  onAuthOrModelChange: async () => undefined,
  onResourceChange: async () => undefined,
  piProfile: "shared",
  profileRoot: "/base/pi-profiles/shared",
  resourceRoots: ["/base/agents/coder"],
});
```

Expected watched paths should include the existing profile paths plus persona file paths.

- [ ] **Step 2: Run watcher tests and verify they fail**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/profile-watcher.test.ts`

Expected: FAIL because `resourceRoots` is not supported.

- [ ] **Step 3: Extend ProfileWatcher with persona watch paths**

In `apps/agent/src/pi/profile-watcher.ts`, import:

```ts
import { getAgentPersonaWatchPaths } from "./persona-files.js";
```

Extend `ProfileWatcherOptions`:

```ts
resourceRoots?: string[];
```

Change `getWatchedProfilePaths` to accept resource roots:

```ts
function getWatchedProfilePaths(profileRoot: string, resourceRoots: string[] = []): string[] {
  return [
    join(profileRoot, "settings.json"),
    join(profileRoot, "models.json"),
    join(profileRoot, "auth.json"),
    ...RESOURCE_DIRS.map((dir) => join(profileRoot, dir)),
    ...resourceRoots.flatMap((root) => getAgentPersonaWatchPaths(root)),
  ];
}
```

Change watcher construction:

```ts
this.watcher = chokidar.watch(getWatchedProfilePaths(options.profileRoot, options.resourceRoots), {
```

Do not change `classifyProfileChange`; persona file changes should classify as `resource` and call `onResourceChange`.

- [ ] **Step 4: Run watcher tests and verify they pass**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/profile-watcher.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing runtime test for persona reload without new session**

Add this test to `apps/agent/tests/pi-runtime.test.ts`:

```ts
it("reloads resources for sessions using a profile when persona files change", async () => {
  const { join } = await import("node:path");
  const tempDir = "/mock/base";
  const config = createRuntimeConfig({
    paths: { ...createRuntimeConfig().paths, baseDir: tempDir },
    telegram: { ...createRuntimeConfig().telegram, defaultAgent: "coder" },
    agents: {
      coder: {
        aliases: [],
        displayName: "Coder",
        id: "coder",
        piProfile: "shared",
        profileRoot: join(tempDir, "pi-profiles", "shared"),
        personaRoot: join(tempDir, "agents", "coder"),
      },
    },
  });
  const { PiRuntime } = await import("../src/pi/runtime.js");
  const runtime = new PiRuntime(config);

  await runtime.prompt({ agentId: "coder", threadKey: "telegram__1" }, "hello", "/mock/workspace");
  await runtime.reloadProfileResources("shared");

  expect(resourceLoaderReload).toHaveBeenCalledTimes(2);
  expect(createAgentSession).toHaveBeenCalledTimes(1);
});
```

Use the existing mock name for `resourceLoader.reload()` in the file. If no standalone `resourceLoaderReload` mock exists, expose it from the current `DefaultResourceLoader` mock before adding this test.

- [ ] **Step 6: Pass persona roots to ProfileWatcher**

In `apps/agent/src/pi/runtime.ts`, update `ensureProfileWatcher` so the watcher for a shared `piProfile` watches persona roots for all agents using that Pi profile:

```ts
const resourceRoots = Object.values(this.config.agents)
  .filter((candidate) => candidate.piProfile === agent.piProfile)
  .map((candidate) => candidate.personaRoot);
```

Pass it to `ProfileWatcher`:

```ts
resourceRoots,
```

Keep `onResourceChange: (piProfile) => this.reloadProfileResources(piProfile)`.

- [ ] **Step 7: Run runtime tests and verify they pass**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/pi-runtime.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/agent/src/pi/profile-watcher.ts apps/agent/src/pi/runtime.ts apps/agent/tests/profile-watcher.test.ts apps/agent/tests/pi-runtime.test.ts
git commit -m "feat: reload sessions when persona files change"
```

---

### Task 7: Full Verification

**Files:**
- No source changes expected unless verification fails.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @shellraining/agent test -- apps/agent/tests/system-prompt.test.ts apps/agent/tests/persona-files.test.ts apps/agent/tests/pi-runtime.test.ts apps/agent/tests/profile-watcher.test.ts apps/agent/tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Run lint and format checks**

Run: `pnpm lint && pnpm fmt:check`

Expected: PASS.

- [ ] **Step 5: Commit any verification fixes**

If any verification command required code changes, commit them:

```bash
git add <changed-files>
git commit -m "fix: stabilize agent persona prompt integration"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage: The plan removes the standalone `packages/system-prompt`, moves prompt construction under `apps/agent`, adds per-Agent persona roots, reads `IDENTITY.md`, `SOUL.md`, and `USER.md` from `<baseDir>/agents/<agentId>/`, injects content directly into system prompt, and reloads existing sessions via `resourceLoader.reload()` on file changes.

Placeholder scan: No task uses TBD/TODO/fill-in placeholders. Steps include concrete files, code snippets, commands, and expected results. The only conditional guidance is limited to adapting existing test helper names where the current test file already owns the helper.

Type consistency: `personaRoot` is added to `ResolvedAgentConfig` before runtime uses it. `AgentPersonaFile` and `buildAgentPersonaPrompt` are introduced before runtime imports them. `ProfileWatcherOptions.resourceRoots` is introduced before runtime passes it.
