# shellRaining

## What

Telegram-first personal coding agent.

## Features

- Telegram DM / mention
- Persistent Pi sessions
- Workspace navigation
- File and image input
- Voice input with optional STT
- File artifact upload
- Scheduled tasks
- Docker service deployment

## Requirements

- Node.js 20-24
- pnpm 10
- Telegram Bot Token
- Public HTTPS webhook URL
- Optional Docker / Docker Compose
- Optional local Telegram Bot API server

## Configuration

- `TELEGRAM_BOT_TOKEN`: Telegram bot token. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token it returns.
- `TELEGRAM_WEBHOOK_SECRET`: Secret token used to verify incoming Telegram webhook requests. Generate a random string and use the same value when registering the webhook.

Optional runtime variables:

- `SHELL_RAINING_ALLOWED_USERS`: Comma-separated Telegram user IDs allowed to use the bot. Get your user ID from a Telegram ID bot or from Telegram update payloads.
- `SHELL_RAINING_WORKSPACE`: Directory the agent starts in. Set this to a host-mounted path when running in Docker.
- `TELEGRAM_API_BASE_URL`: Custom Telegram Bot API endpoint. Leave empty to use the official API; set it only when running a local Telegram Bot API server.

## Run Locally

```bash
pnpm install
cp .env.example .env
pnpm dev
```

## Production

```bash
pnpm build
pnpm start
```

## Docker

```bash
docker build -t shellraining:local .
docker compose up -d
```

Notes:

- Default port: `3457`
- Health check: `/health`
- Webhook path: `/webhook/telegram`
- Runtime state: `~/.shellRaining`
- Default workspace: `~/.shellRaining/shellRaining-workspace`
- Set `SHELL_RAINING_WORKSPACE` explicitly for Docker deployment

## Telegram Webhook

Webhook URL:

```text
https://<your-domain>/webhook/telegram
```

The local Telegram Bot API server is optional. Without it, shellRaining uses the official Telegram API.

## Commands

- `/start`
- `/help`
- `/pwd`
- `/cd`
- `/home`
- `/session`
- `/new`
- `/status`

## Development

```bash
pnpm test
pnpm build
pnpm check
pnpm lint
pnpm fmt
```
