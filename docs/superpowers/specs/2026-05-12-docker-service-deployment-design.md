# Docker Service Deployment Design

## Goal

Run shellRaining as a persistent Docker service in the existing self-hosted setup, so it survives terminal restarts and keeps using the existing Telegram webhook route on `telegram.shellraining.xyz`.

## Current State

The project is a pnpm workspace. The root `start` script runs `@shellraining/agent`, which starts a Hono HTTP server on `SHELL_RAINING_PORT` or port `3457`. The Telegram adapter runs in webhook mode and exposes `POST /webhook/telegram`.

The current `.env` does not set `SHELL_RAINING_WORKSPACE` or `SHELL_RAINING_BASE_DIR`. Without overrides, `SHELL_RAINING_BASE_DIR` resolves to `~/.shellRaining`, and `SHELL_RAINING_WORKSPACE` resolves to `~/.shellRaining/shellRaining-workspace`. For Docker deployment, the workspace should be set explicitly.

The existing FRP client already forwards `telegram.shellraining.xyz` to local port `3457`. The existing local Telegram Bot API server runs separately at host port `8090` and is optional. Without it, users can still use the official Telegram Bot API by leaving `TELEGRAM_API_BASE_URL` unset.

## Architecture

Add a production Docker image for shellRaining and run it with Docker Compose. The personal deployment will live under `~/docker-services/shellraining-server/`, consistent with the other self-hosted services.

The container listens on port `3457`, bound to the host so the existing FRP route continues to work. The service uses `restart: unless-stopped` for persistence.

Use the official `node:24-bookworm-slim` image in both build and runtime stages. This keeps the image smaller than the full Debian image while avoiding Alpine musl compatibility issues for Node dependencies and agent tooling.

## Compose Scope

The shellRaining compose file will not include `telegram-bot-api-server` by default. That service is optional infrastructure, already exists as an independent service, and can be shared or omitted.

For this personal deployment, shellRaining will connect to the existing local Bot API through `http://host.docker.internal:8090`. Other users can omit `TELEGRAM_API_BASE_URL` and use `https://api.telegram.org` by default.

## Host Access

The personal compose file will bind mount the full home directory:

```yaml
volumes:
  - /Users/shellraining:/host/home
```

The deployment will set:

```env
SHELL_RAINING_WORKSPACE=/host/home
SHELL_RAINING_BASE_DIR=/host/home/.shellRaining
```

This allows the agent to operate on the host home directory while keeping shellRaining state at the same host location as the non-Docker setup. Because `/Users/shellraining` is mounted, no separate `~/.shellRaining` mount is required; it is already available at `/host/home/.shellRaining`.

If Pi state is needed, it is also available through the same home mount at `/host/home/.pi`. Environment variables or config should point runtime state to mounted paths rather than the container's unmounted `/home/node`.

## Telegram Files

When using the local Bot API server, shellRaining needs read access to the Bot API data directory for local file downloads. The personal compose file will mount the existing data directory read-only:

```yaml
volumes:
  - /Users/shellraining/docker-services/telegram-bot-api-server/data:/var/lib/telegram-bot-api:ro
```

The environment will set:

```env
TELEGRAM_LOCAL_FILE_SERVER_ROOT=/var/lib/telegram-bot-api
TELEGRAM_LOCAL_FILE_HOST_ROOT=/var/lib/telegram-bot-api
```

This maps Telegram local file paths to a readable container path without giving shellRaining write access to the Bot API data.

## Files To Add

Add repository files:

- `Dockerfile`: multi-stage build and runtime image.
- `.dockerignore`: excludes dependencies, build output, git data, secrets, and local state from Docker build context.

Add personal deployment files outside the repository:

- `~/docker-services/shellraining-server/docker-compose.yml`: production compose for this host.
- `~/docker-services/shellraining-server/.env.example`: safe template if useful; do not copy secrets into committed files.

The actual runtime `.env` should stay local and uncommitted.

## Verification

Build the image with Docker Compose, start the service, and verify:

- `GET http://127.0.0.1:3457/health` returns `{ "status": "ok" }`.
- Container restarts under Docker Compose and is not tied to the terminal session.
- The existing FRP route can continue forwarding `telegram.shellraining.xyz` to host port `3457`.
