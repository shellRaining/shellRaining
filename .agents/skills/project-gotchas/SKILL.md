---
name: project-gotchas
description: shellRaining 项目的非显而易见坑点和调试线索。
---

# Project Gotchas

- (2026-04-14) Telegram `/new` 不要调用 Pi SDK `session.newSession()` 后立刻 dispose；Pi `SessionManager` 会延迟到首个 assistant message 才落盘新 session，过早 dispose 会丢掉未落盘 session，下一条 prompt 又 `continueRecent` 回旧模型。
- (2026-04-15) Telegram cloud Bot API 的 `getFile` 只能下载 20MB 以内文件；shellRaining 不设自己的附件大小限制，超过该限制要通过 `TELEGRAM_API_BASE_URL` 接本地 Bot API server。
