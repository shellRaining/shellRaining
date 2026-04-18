# Cron Condition Field Design

## Overview

Add an optional `condition` field to CronJob that executes a bash command before the payload. The job only runs when the condition is met (exit code 0). This enables use cases like "check if a process finished", "check if a file exists", "poll an external state before acting".

## Data Model

`CronJob` interface新增可选字段：

```typescript
condition?: {
  command: string;
  timeoutMs?: number; // 默认 30000
};
```

`CronJobInput`、`cron_create` tool 参数同步新增此可选字段。`CronStoreData` 无需改动。

## Execution Flow

在 `CronService.runJob()` 中，获取 workspace 之后、调用 `runtime.prompt()` 之前插入 condition 检查：

1. 若 job 无 `condition` 字段，直接执行 prompt（现有逻辑不变）
2. 若有，通过 `deps.execCommand(command, cwd, timeoutMs)` 执行 bash 命令
3. 根据结果分流：
   - exit 0：条件满足，继续执行 prompt
   - exit 1：条件不满足，静默跳过本次运行。不修改 state（不更新 lastRunAtMs、不影响 consecutiveErrors），正常调度下次运行
   - exit >= 2 或 spawn 异常（命令不存在、超时、被信号杀死）：视为脚本错误，走 `buildFailureJob` 逻辑，计入 consecutiveErrors

### CronServiceDeps 新增

```typescript
execCommand: (command: string, cwd: string, timeoutMs: number) =>
  Promise<{
    exitCode: number | null; // null 表示 spawn 失败
    signal?: NodeJS.Signals;
  }>;
```

实现层在 `src/index.ts` 使用 `node:child_process` 的 `execFile('bash', ['-c', command])` 注入。

## Tool Description

`cron_create` tool 的 `description` 追加简短的退出码规则：

```
Condition rules (exit codes):
- exit 0: condition met, job will run
- exit 1: condition not met, silently skip
- exit 2+: script error, counts as failure

Guidelines:
- Keep scripts short. Use && / || for multi-step checks
- Do NOT use "set -e"
- Write diagnostics to stderr if needed
- Only set timeoutMs when the check genuinely takes time
```

## Skill 层指引

cron SKILL.md 新增 `## Condition` 章节（位于 `## Build The Schedule` 之后）。内容：

### 何时使用

当用户隐含"只有某条件成立时才执行"时使用。常见信号：

- "等 XX 完成后提醒我"
- "如果 XX 就通知我"
- "每隔 N 分钟检查，XX 就绪后通知"

用户没有表达条件意图时，不主动添加。

### 退出码规则

- exit 0：条件满足，执行 payload
- exit 1：条件不满足，静默跳过
- exit 2+：脚本自身错误，仅用于不可恢复异常

### 编写模板

只允许三种模式：

1. 检查命令退出码：`pgrep -f "my-server"`
2. 检查命令输出：`test "$( curl -sf https://example.com/health )" = "ok"`
3. 组合检查：`test -f /tmp/done && test "$( cat /tmp/done )" = "ready"`

### 禁止事项

- 禁止 `set -e`
- 禁止多行脚本（单行，用 `&&`/`||` 连接）
- 禁止依赖 stdout 内容
- 禁止自行发挥其他写法

### timeoutMs 规则

- 默认 30 秒
- 只在脚本确实需要等待时才设置
- 不超过 300 秒

## Files Changed

| 文件                    | 改动                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `src/cron/types.ts`     | CronJob 新增 `condition?` 字段                                 |
| `src/cron/normalize.ts` | CronJobInput 新增对应字段                                      |
| `src/cron/service.ts`   | CronServiceDeps 新增 `execCommand`；runJob 插入 condition 检查 |
| `src/cron/tools.ts`     | cron_create 参数新增 `condition`，description 加退出码规则     |
| `src/index.ts`          | 注入 `execCommand` 实现（child_process）                       |
| cron SKILL.md           | 新增 Condition 章节                                            |

## Tests

新增 condition 相关测试，通过 mock `execCommand` 覆盖：

1. 无 condition -- 现有行为不变
2. exit 0 -- 正常执行 prompt
3. exit 1 -- 静默跳过，state 不变
4. exit 2+ -- 走 buildFailureJob
5. spawn 异常 -- 走 buildFailureJob
6. 超时 -- 走 buildFailureJob
7. timeoutMs 未设置时默认 30 秒
8. timeoutMs 设置时使用指定值
