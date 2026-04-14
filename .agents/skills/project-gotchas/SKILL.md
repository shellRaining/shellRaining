---
name: project-gotchas
description: shellRaining 项目的非显而易见坑点和调试线索。
---

# Project Gotchas

- (2026-04-14) Telegram `/new` 不要调用 Pi SDK `session.newSession()` 后立刻 dispose；Pi `SessionManager` 会延迟到首个 assistant message 才落盘新 session，过早 dispose 会丢掉未落盘 session，下一条 prompt 又 `continueRecent` 回旧模型。
