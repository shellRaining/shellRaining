# shell-raining

Telegram-first personal coding agent for shellraining.

Core stack:

- Pi CodingAgent SDK
- Vercel Chat SDK Telegram adapter
- Hono webhook server

Features in v0:

- Telegram DM and mention entrypoints
- Persistent per-thread Pi sessions with `/session` listing and switching
- Persistent workspace state
- Pi skills sync via `~/.pi/agent/settings.json`
- Tool activity status updates
- File artifact detection and Telegram upload
- Commands: `/start`, `/help`, `/pwd`, `/cd`, `/home`, `/session`, `/session switch <n>`, `/new`, `/status`

Runtime notes:

- Start the service with `pnpm dev` or `pnpm start` after `pnpm build`.
- Telegram should be configured to send webhooks to `/webhook/telegram`.
- On startup, shell-raining merges `SHELL_RAINING_SKILLS_DIR` into `~/.pi/agent/settings.json` and writes a backup under `~/.shell-raining/backups/` when changes are needed.

Development:

```bash
pnpm install
cp .env.example .env
pnpm test
pnpm dev
```
