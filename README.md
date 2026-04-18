# shellRaining

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

Telegram input support:

- Text and emoji are sent to Pi as prompt text.
- Telegram photo/image attachments are downloaded, saved under `~/.shellRaining/inbox/`, and passed to Pi as image inputs.
- Telegram document attachments such as TXT, PDF, and XLSX are downloaded and sent to Pi as local absolute file paths. shellRaining does not parse document contents itself.
- Telegram voice/audio attachments are downloaded and sent as local absolute file paths. When STT is configured, the transcript is included in the prompt.
- Telegram stickers are represented as lightweight text using their sticker emoji when Telegram provides one.
- shellRaining does not apply an internal attachment size cap. With Telegram's cloud Bot API, `getFile` can only download files up to 20 MB; for larger Telegram files, run a local Bot API server and set `TELEGRAM_API_BASE_URL`.
- When the local Bot API server runs in Docker, set `TELEGRAM_LOCAL_FILE_SERVER_ROOT=/var/lib/telegram-bot-api` and `TELEGRAM_LOCAL_FILE_HOST_ROOT` to the host bind mount so container file paths can be read by shellRaining.

Optional STT configuration:

```bash
SHELL_RAINING_STT_BASE_URL=https://stt.example.com
SHELL_RAINING_STT_API_KEY=optional-token
SHELL_RAINING_STT_MODEL=whisper-1
```

Runtime notes:

- Start the service with `pnpm dev` or `pnpm start` after `pnpm build`.
- Telegram should be configured to send webhooks to `/webhook/telegram`.
- On startup, shellRaining merges `SHELL_RAINING_SKILLS_DIR` into `~/.pi/agent/settings.json` and writes a backup under `~/.shellRaining/backups/` when changes are needed.

Development:

```bash
pnpm install
cp .env.example .env
pnpm test
pnpm dev
pnpm run lint
pnpm run fmt
```
