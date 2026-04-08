---
name: project-architecture
description: 已确认的项目架构决策和复用边界，后续实现 shell-raining 时优先遵守。
---

# Project Architecture

- (2026-04-09) shell-raining 第一版是 Telegram-first 个人 agent，Pi CodingAgent 是唯一执行内核，Chat SDK 只负责 Telegram transport。
- (2026-04-09) skills 接入优先复用 Pi 原生 `settings.json` 的 `skills` 配置，不自建平行 skill registry。
