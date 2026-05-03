# Lint Warning 分批修复计划

## 背景

启用 `oxlint --type-aware --type-check` 后，项目有 371 个 warning（0 error）。已关闭 `prefer-readonly-parameter-types`（162 个），剩余 371 个分布在生产代码和测试代码中。

## 目标

将生产代码中的 89 个 warning 全部修复，使 `pnpm lint` 在生产代码上零 warning。

## 规则分布（生产代码）

| 规则                           | 数量 | 修复模式                                             |
| ------------------------------ | ---- | ---------------------------------------------------- |
| `strict-boolean-expressions`   | 52   | `if (x)` → `if (x !== undefined)` / `if (x != null)` |
| `prefer-nullish-coalescing`    | 14   | `\|\|` → `??`                                        |
| `no-confusing-void-expression` | 9    | `() => expr` → `() => { expr; }`                     |
| `no-unsafe-type-assertion`     | 8    | 加类型守卫或改用更安全的类型                         |
| `require-await`                | 5    | 去掉 `async` 关键字                                  |
| `no-unsafe-return`             | 1    | 改善返回类型                                         |

## 分批方案

### Batch 1：Top 8 高 warning 文件（69 个 warning）

| 文件                                       | 数量 | 主要规则                                                                |
| ------------------------------------------ | ---- | ----------------------------------------------------------------------- |
| `apps/agent/src/bot.ts`                    | 15   | strict-boolean(9), nullish-coal(4), unsafe-assert(2)                    |
| `apps/agent/src/runtime/telegram-input.ts` | 12   | strict-boolean(8), nullish-coal(2), unsafe-assert(1), confusing-void(1) |
| `apps/agent/src/index.ts`                  | 9    | strict-boolean(4), confusing-void(2), require-await(2), nullish-coal(1) |
| `apps/agent/src/config/loader.ts`          | 8    | strict-boolean(6), unsafe-assert(1), nullish-coal(1)                    |
| `apps/agent/src/runtime/stt.ts`            | 7    | strict-boolean(4), nullish-coal(3)                                      |
| `apps/agent/src/pi/runtime.ts`             | 7    | strict-boolean(5), require-await(1), unsafe-assert(1)                   |
| `apps/agent/src/config/agents.ts`          | 7    | strict-boolean(5), nullish-coal(1), unsafe-assert(1)                    |
| `apps/agent/src/pi/profile-watcher.ts`     | 5    | confusing-void(4), strict-boolean(1)                                    |

### Batch 2：剩余 15 个生产文件（20 个 warning）

| 文件                                  | 数量 |
| ------------------------------------- | ---- |
| `apps/agent/src/pi/skill-watcher.ts`  | 4    |
| `apps/agent/src/config/values.ts`     | 4    |
| `apps/agent/src/config/service.ts`    | 2    |
| `apps/agent/src/cron/tools.ts`        | 2    |
| `packages/cron/src/store.ts`          | 2    |
| `apps/agent/src/runtime/workspace.ts` | 2    |
| `apps/agent/src/cron/normalize.ts`    | 2    |
| 其余 8 个文件                         | 各 1 |

## 工作流

每批：

1. 读取目标文件
2. 修复所有 warning
3. `pnpm lint` 确认 warning 数下降
4. `pnpm typecheck` 确认不引入编译错误
5. 提交

## 验收标准

- `pnpm lint` 生产代码零 warning
- `pnpm typecheck` 通过
- 测试代码 warning 不增加
