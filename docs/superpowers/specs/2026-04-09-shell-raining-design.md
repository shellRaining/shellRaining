# shellRaining Design

日期：2026-04-09

## 目标

shellRaining 是一个 Telegram-first 的个人工程代理，定位为强工具型第二人格。第一版只服务单一真实用户，入口以 Telegram 为主，执行内核固定为 Pi CodingAgent。

## 关键设计结论

- 复用 `mini-claw` 的工作区、会话、输出分段、文件回传思路。
- 复用 `chat` 的 Telegram adapter 作为传输层，不把 Chat SDK 当成 agent 编排框架。
- 复用 Pi 原生 skills 机制，通过 `~/.pi/agent/settings.json` 接入 `/Users/shellraining/Documents/dotfiles/skills`。
- 第一版不保留 `/shell` 命令。
- 项目按子项目推进，先完成 Telegram + Pi 核心闭环，再继续增强。

## 系统边界

- 用户通过 Telegram 私聊、mention、已订阅线程与 shellRaining 交互。
- shellRaining 是 Node.js 常驻服务，负责 Telegram 路由、本地状态、Pi 会话与结果展示。
- `docker-services` 中的现有服务作为默认环境画像，用于高频 skills 的真实运行环境。

## 架构

### 1. Telegram Transport Layer

使用 `@chat-adapter/telegram` 与 `chat` 处理 webhook、线程抽象、消息投递和 typing。

### 2. Conversation Runtime

管理线程级限流、线程到 Pi 会话映射、工作目录状态和命令路由。

### 3. Pi Session Bridge

使用 Pi SDK 创建、恢复、切换线程会话；收集文本增量、工具事件和最终消息；生成用户可见状态。

### 4. Pi Native Skill Loading

通过 settings 同步 `dotfiles/skills` 到 Pi 的 `skills` 配置项，避免自建平行技能系统。

### 5. Environment Profile

注入 crawl、vikunja、api 等服务地址，为 skills 提供默认环境。

## 状态持久化

- 基础目录：`~/.shell-raining/`
- 工作区状态：`state/workspaces.json`
- 每线程 Pi session 目录：`sessions/<thread-key>/`
- Pi settings 备份：`backups/pi-settings-*.json`

## 命令

- `/start`
- `/help`
- `/pwd`
- `/cd <path>`
- `/home`
- `/session`
- `/new`
- `/status`

## 非目标

- 多租户
- 复杂人格系统
- Web Chat 主入口
- 自研 skill registry
