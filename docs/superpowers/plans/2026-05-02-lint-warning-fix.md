# Lint Warning 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复生产代码中 89 个 lint warning，使 `pnpm lint` 在生产代码上零 warning。

**Architecture:** 按文件分批修复，每个 task 处理 1-3 个相关文件。修复后运行 `pnpm lint` 和 `pnpm typecheck` 验证。

**Tech Stack:** oxlint, TypeScript, pnpm

---

## 修复规则参考

| 规则                           | 修复模式                                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| `strict-boolean-expressions`   | `if (x)` → `if (x !== undefined)` / `if (x != null)` / `if (x !== "")` |
| `prefer-nullish-coalescing`    | `\|\|` → `??`                                                          |
| `no-confusing-void-expression` | `() => expr` → `() => { expr; }` 或加 `void`                           |
| `no-unsafe-type-assertion`     | 改用类型守卫或更安全的类型断言                                         |
| `require-await`                | 去掉 `async` 关键字                                                    |
| `no-unsafe-return`             | 改善返回类型标注                                                       |

---

### Task 1: config/values.ts

**Files:**

- Modify: `apps/agent/src/config/values.ts`

**规则:** strict-boolean-expressions(3), prefer-nullish-coalescing(1)

- [ ] **Step 1: 修复 strict-boolean-expressions**

```typescript
// Line 3: if (!value) → if (value === undefined)
// Line 14: if (!resolved) → if (resolved === undefined)
// Line 25: if (!resolved) → if (resolved === undefined)
```

- [ ] **Step 2: 修复 prefer-nullish-coalescing**

```typescript
// Line 42: if (!resolved) → if (resolved === undefined)
```

- [ ] **Step 3: 验证**

```bash
pnpm lint 2>&1 | grep 'values.ts'
pnpm typecheck
```

---

### Task 2: config/agents.ts

**Files:**

- Modify: `apps/agent/src/config/agents.ts`

**规则:** strict-boolean-expressions(5), prefer-nullish-coalescing(2), require-await(1)

- [ ] **Step 1: 修复 strict-boolean-expressions + prefer-nullish-coalescing**

```typescript
// Line 28: if (!trimmed) → if (trimmed === "")
// Line 44: if (!entries) → if (entries === undefined)
// Line 68: agent?.piProfile?.trim() || agentId → agent?.piProfile?.trim() ?? agentId
// Line 79: agent?.displayName?.trim() || agentId → agent?.displayName?.trim() ?? agentId
// Line 94: if (configured && agents[configured]) → if (configured !== undefined && agents[configured] !== undefined)
// Line 97: require-await — 检查 async 函数是否缺少 await
// Line 100: Object.keys(agents).sort()[0] ?? "default" — 已经是 ??，检查其他位置
```

- [ ] **Step 2: 验证**

```bash
pnpm lint 2>&1 | grep 'agents.ts'
pnpm typecheck
```

---

### Task 3: config/loader.ts

**Files:**

- Modify: `apps/agent/src/config/loader.ts`

**规则:** strict-boolean-expressions(6), prefer-nullish-coalescing(2), no-unsafe-type-assertion(1)

- [ ] **Step 1: 修复 strict-boolean-expressions**

```typescript
// Line 30: configuredConfigPath || getConfigPath() → configuredConfigPath ?? getConfigPath()
// Line 70: if (!token) → if (token === undefined)
// Line 75: fileConfig.paths?.baseDir — ternary with nullable string, change to explicit check
// Line 93: fileConfig.telegram?.apiBaseUrl — ternary check, change to explicit
// Line 108: resolveConfigValue(...) || getCronJobsPath(baseDir) → resolveConfigValue(...) ?? getCronJobsPath(baseDir)
// Line 116: no-unsafe-type-assertion — 检查 JSON.parse 类型断言
```

- [ ] **Step 3: 验证**

```bash
pnpm lint 2>&1 | grep 'loader.ts'
pnpm typecheck
```

---

### Task 4: config/service.ts + config/changes.ts + config/merge.ts

**Files:**

- Modify: `apps/agent/src/config/service.ts` (2 warnings)
- Modify: `apps/agent/src/config/changes.ts` (1 warning)
- Modify: `apps/agent/src/config/merge.ts` (1 warning)

- [ ] **Step 1: 修复 service.ts**

```typescript
// Line 47: if (this.watcher) — this.watcher 是 ConfigWatcher | undefined
// 改为: if (this.watcher !== undefined)
// Line 61: if (!watcher) — watcher 是 ConfigWatcher
// 改为: if (watcher === undefined)
```

- [ ] **Step 2: 修复 changes.ts**

```typescript
// Line 46: if (!key) — key 是 string | undefined
// 改为: if (key === undefined)
```

- [ ] **Step 3: 修复 merge.ts**

```typescript
// Line 8: if (source === undefined) — 已经是显式检查，无需修改
// 检查实际 warning 位置
```

- [ ] **Step 4: 验证**

```bash
pnpm lint 2>&1 | grep -E '(service\.ts|changes\.ts|merge\.ts)'
pnpm typecheck
```

---

### Task 5: runtime/stt.ts

**Files:**

- Modify: `apps/agent/src/runtime/stt.ts`

**规则:** strict-boolean-expressions(4), prefer-nullish-coalescing(3)

- [ ] **Step 1: 修复 strict-boolean-expressions**

```typescript
// Line 26: if (!baseUrl) → if (baseUrl === undefined)
// Line 40-41: input.config.apiKey?.trim() ? ... : undefined — ternary with nullable
// 改为显式: const apiKey = input.config.apiKey?.trim(); if (apiKey !== undefined) ...
```

- [ ] **Step 2: 修复 prefer-nullish-coalescing**

```typescript
// Line 31: input.config.model?.trim() || "whisper-1" → input.config.model?.trim() ?? "whisper-1"
// Line 35: input.mimeType || "application/octet-stream" → input.mimeType ?? "application/octet-stream"
```

- [ ] **Step 3: 验证**

```bash
pnpm lint 2>&1 | grep 'stt\.ts'
pnpm typecheck
```

---

### Task 6: runtime/telegram-input.ts

**Files:**

- Modify: `apps/agent/src/runtime/telegram-input.ts`

**规则:** strict-boolean-expressions(8), prefer-nullish-coalescing(2), no-unsafe-type-assertion(1), no-confusing-void-expression(1)

- [ ] **Step 1: 修复 strict-boolean-expressions**

```typescript
// Line 141: if (text) — text 是 string | null | undefined
// 改为: if (text !== undefined && text !== null && text !== "")
// 或者: if (text != null && text !== "")
```

- [ ] **Step 2: 修复 prefer-nullish-coalescing**

```typescript
// Line 170: attachment.mimeType || "image/jpeg" → attachment.mimeType ?? "image/jpeg"
// Line 196: transcript?.trim() — 这里已经是可选链，检查是否有 || 需要改
```

- [ ] **Step 3: 验证**

```bash
pnpm lint 2>&1 | grep 'telegram-input\.ts'
pnpm typecheck
```

---

### Task 7: runtime/access-control.ts + runtime/workspace.ts

**Files:**

- Modify: `apps/agent/src/runtime/access-control.ts` (1 warning: strict-boolean-expressions)
- Modify: `apps/agent/src/runtime/workspace.ts` (1 warning: strict-boolean-expressions)

- [ ] **Step 1: 修复 access-control.ts**

```typescript
// Line 15: if (!userId) — userId 是 string | undefined
// 改为: if (userId === undefined)
```

- [ ] **Step 2: 修复 workspace.ts**

```typescript
// Line 54: if (cwd) — cwd 是 string | undefined
// 改为: if (cwd !== undefined)
```

- [ ] **Step 3: 验证**

```bash
pnpm lint 2>&1 | grep -E '(access-control\.ts|workspace\.ts)'
pnpm typecheck
```

---

### Task 8: runtime/telegram-attachments.ts

**Files:**

- Modify: `apps/agent/src/runtime/telegram-attachments.ts` (1 warning: no-unsafe-type-assertion)

- [ ] **Step 1: 修复 telegram-attachments.ts**

```typescript
// Line 33: if (!trimmed) — trimmed 是 string | undefined
// 改为: if (trimmed === undefined || trimmed === "")
```

- [ ] **Step 2: 验证**

```bash
pnpm lint 2>&1 | grep 'telegram-attachments\.ts'
pnpm typecheck
```

---

### Task 9: bot.ts

**Files:**

- Modify: `apps/agent/src/bot.ts`

**规则:** strict-boolean-expressions(9), prefer-nullish-coalescing(4), no-unsafe-type-assertion(4), no-confusing-void-expression(1)

- [ ] **Step 1: 修复 strict-boolean-expressions**

```typescript
// Line 36: if (!text?.startsWith("/")) → if (text == null || !text.startsWith("/"))
// Line 85: input.telegramApiBaseUrl || "https://api.telegram.org" → 显式检查
// Line 98: message.text?.trim() || message.attachments?.length || message.raw?.sticker
// 改为: 显式检查每个条件
// Line 199: session.name || session.firstMessage || "(empty)" → 用 ??
// Line 217: if (!target) → if (target === undefined)
// Line 228: if (!agent) → if (agent === undefined)
```

- [ ] **Step 2: 修复 prefer-nullish-coalescing**

```typescript
// Line 85: || → ??
// Line 199: || → ??
```

- [ ] **Step 3: 修复 no-unsafe-type-assertion (4 处)**

```typescript
// Line 228: config.agents[config.telegram.defaultAgent] — 需要类型守卫
// Line 301: error as Error & { code?: string } — 需要类型守卫
// Line 351/364: message as TelegramInputMessage — 需要类型守卫
```

- [ ] **Step 4: 修复 no-confusing-void-expression**

```typescript
// Line 376: 检查 arrow function 返回 void 的位置
```

- [ ] **Step 5: 验证**

```bash
pnpm lint 2>&1 | grep 'bot\.ts'
pnpm typecheck
```

---

### Task 10: index.ts

**Files:**

- Modify: `apps/agent/src/index.ts`

**规则:** strict-boolean-expressions(5), require-await(2), prefer-nullish-coalescing(1), no-unsafe-type-assertion(1)

- [ ] **Step 1: 修复 strict-boolean-expressions**

```typescript
// Line 25-28: process.env.HTTP_PROXY || ... — 4 个 env 检查
// 改为: process.env.HTTP_PROXY !== undefined || ...
// Line 30: undici 类型断言
// Line 66: timezone || "UTC" → timezone ?? "UTC"
```

- [ ] **Step 2: 修复 require-await**

```typescript
// Line 66: resolveCronPromptTimezone — 检查是否需要 async
// Line 115: exec 的 execute 回调
```

- [ ] **Step 3: 修复 no-unsafe-type-assertion**

```typescript
// Line 131: 检查具体位置
```

- [ ] **Step 4: 验证**

```bash
pnpm lint 2>&1 | grep 'index\.ts'
pnpm typecheck
```

---

### Task 11: pi/runtime.ts

**Files:**

- Modify: `apps/agent/src/pi/runtime.ts`

**规则:** strict-boolean-expressions(7), prefer-nullish-coalescing(2)

- [ ] **Step 1: 修复 strict-boolean-expressions**

```typescript
// Line 175: if (!agent) → if (agent === undefined)
// Line 217: if (existing?.stale && !this.inflight.has(scopeKey))
// 改为: if (existing?.stale === true && !this.inflight.has(scopeKey))
// Line 247: if (!agentIds.has(...)) → 检查具体用法
// Line 354: if (eventError) → if (eventError !== undefined)
// Line 387: if (showThinking && ...) → 检查 showThinking 类型
// Line 390: if (assistantError) → if (assistantError !== undefined)
```

- [ ] **Step 2: 修复 prefer-nullish-coalescing**

```typescript
// Line 183: agent.piProfile || ... → agent.piProfile ?? ...
// Line 217: 检查具体 || 位置
```

- [ ] **Step 3: 验证**

```bash
pnpm lint 2>&1 | grep 'runtime\.ts'
pnpm typecheck
```

---

### Task 12: pi/profile-watcher.ts + pi/skill-watcher.ts + pi/session-store.ts

**Files:**

- Modify: `apps/agent/src/pi/profile-watcher.ts` (5 warnings)
- Modify: `apps/agent/src/pi/skill-watcher.ts` (4 warnings)
- Modify: `apps/agent/src/pi/session-store.ts` (1 warning)

- [ ] **Step 1: 修复 profile-watcher.ts no-confusing-void-expression**

```typescript
// Line 62: void this.options.onAuthOrModelChange(...) — 已经有 void
// 检查实际 warning: 可能是 setTimeout 回调返回了 void expression
```

- [ ] **Step 2: 修复 skill-watcher.ts**

```typescript
// Line 33: if (this.watchedPaths.has(path)) — 已经是显式检查
// 检查实际 warning 位置
```

- [ ] **Step 3: 验证**

```bash
pnpm lint 2>&1 | grep -E '(profile-watcher\.ts|skill-watcher\.ts|session-store\.ts)'
pnpm typecheck
```

---

### Task 13: cron/tools.ts

**Files:**

- Modify: `apps/agent/src/cron/tools.ts` (2 warnings: strict-boolean-expressions, no-unsafe-return)

- [ ] **Step 1: 修复 tools.ts**

```typescript
// Line 27: strict-boolean-expressions — 检查 tz 条件
// 某处: no-unsafe-return — 检查返回类型
```

- [ ] **Step 2: 验证**

```bash
pnpm lint 2>&1 | grep 'tools\.ts'
pnpm typecheck
```

---

### Task 14: packages/cron

**Files:**

- Modify: `packages/cron/src/store.ts` (2 warnings: no-unsafe-type-assertion, strict-boolean-expressions)

- [ ] **Step 1: 修复 store.ts**

```typescript
// Line 18: JSON.parse(raw) as CronStoreData — no-unsafe-type-assertion
// 改为: 使用 zod 或手动验证
// Line 25: strict-boolean-expressions — 检查条件写法
```

- [ ] **Step 2: 验证**

```bash
pnpm lint 2>&1 | grep 'packages/cron'
pnpm typecheck
```

---

### Task 15: 最终验证

- [ ] **Step 1: 运行完整 lint**

```bash
pnpm lint
```

预期: 生产代码零 warning（测试代码 warning 不应增加）。

- [ ] **Step 2: 运行 typecheck**

```bash
pnpm typecheck
```

预期: 通过。

- [ ] **Step 3: 运行 fmt**

```bash
pnpm fmt
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "fix: resolve all production lint warnings"
```
