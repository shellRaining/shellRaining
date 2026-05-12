# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
ENV CI=true
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

FROM base AS runtime
ENV NODE_ENV=production
ENV SHELL_RAINING_PORT=3457
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3457
CMD ["pnpm", "start"]
