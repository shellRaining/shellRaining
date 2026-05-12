# Docker Service Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package shellRaining as a persistent Docker service and add a personal Docker Compose deployment that can run under `~/docker-services/shellraining-server/`.

**Architecture:** Build the pnpm workspace with a multi-stage official Node slim image, then run the root `pnpm start` command in a runtime stage. Keep Telegram Bot API as an external optional service and connect the personal deployment to the existing host service through `host.docker.internal:8090`.

**Tech Stack:** Docker, Docker Compose, Node.js 24, pnpm 10, TypeScript workspace.

---

## File Structure

- Create `Dockerfile`: repository image definition with build and runtime stages.
- Create `.dockerignore`: keep build context small and exclude secrets/local runtime state.
- Create `/Users/shellraining/docker-services/shellraining-server/docker-compose.yml`: personal runtime compose file outside the repository.
- Do not modify `~/docker-services/telegram-bot-api-server/`: it remains an independent optional service.

## Task 1: Add Docker Build Files

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```dockerignore
.git
.env
.env.*
node_modules
**/node_modules
dist
**/dist
coverage
docs/superpowers/plans
docs/superpowers/specs
.DS_Store
npm-debug.log*
pnpm-debug.log*
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts ./
COPY apps/agent/package.json apps/agent/package.json
COPY packages/cron/package.json packages/cron/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
ENV SHELL_RAINING_PORT=3457
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3457
CMD ["pnpm", "start"]
```

- [ ] **Step 3: Build image locally**

Run: `docker build -t shellraining:local .`

Expected: Docker build completes successfully and prints an image ID.

## Task 2: Add Personal Compose Deployment

**Files:**
- Create: `/Users/shellraining/docker-services/shellraining-server/docker-compose.yml`

- [ ] **Step 1: Ensure service directory exists**

Run: `mkdir -p /Users/shellraining/docker-services/shellraining-server`

Expected: Directory exists.

- [ ] **Step 2: Create personal compose file**

```yaml
services:
  shellraining:
    build:
      context: /Users/shellraining/Documents/writable-project/shellRaining
      dockerfile: Dockerfile
    image: shellraining:local
    container_name: shellraining
    restart: unless-stopped
    env_file:
      - /Users/shellraining/Documents/writable-project/shellRaining/.env
    environment:
      NODE_ENV: production
      SHELL_RAINING_PORT: "3457"
      SHELL_RAINING_BASE_DIR: /host/home/.shellRaining
      SHELL_RAINING_WORKSPACE: /host/home
      TELEGRAM_API_BASE_URL: http://host.docker.internal:8090
      TELEGRAM_LOCAL_FILE_SERVER_ROOT: /var/lib/telegram-bot-api
      TELEGRAM_LOCAL_FILE_HOST_ROOT: /var/lib/telegram-bot-api
    ports:
      - "127.0.0.1:3457:3457"
    volumes:
      - /Users/shellraining:/host/home
      - /Users/shellraining/docker-services/telegram-bot-api-server/data:/var/lib/telegram-bot-api:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

- [ ] **Step 3: Validate compose config**

Run: `docker compose -f /Users/shellraining/docker-services/shellraining-server/docker-compose.yml config`

Expected: Docker Compose renders the service without schema errors.

## Task 3: Verify Runtime

**Files:**
- No file changes.

- [ ] **Step 1: Start service**

Run: `docker compose -f /Users/shellraining/docker-services/shellraining-server/docker-compose.yml up -d --build`

Expected: Compose builds the image and starts container `shellraining`.

- [ ] **Step 2: Check container status**

Run: `docker compose -f /Users/shellraining/docker-services/shellraining-server/docker-compose.yml ps`

Expected: Service `shellraining` is `Up`.

- [ ] **Step 3: Check HTTP health endpoint**

Run: `curl -fsS http://127.0.0.1:3457/health`

Expected: `{"status":"ok"}`.

- [ ] **Step 4: Inspect logs if health fails**

Run: `docker logs shellraining --tail 100`

Expected: Logs show either `HTTP server listening` or a concrete configuration/runtime error to fix.

## Self-Review

- Spec coverage: Docker image, compose file, external Telegram Bot API, full home mount, explicit workspace/base dir, and health verification are covered.
- Placeholder scan: No placeholders remain.
- Type consistency: Environment variable names match existing config loader names and README examples.
