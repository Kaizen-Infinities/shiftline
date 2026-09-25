# syntax=docker/dockerfile:1.7
# Workspace-aware build for @shiftline/api. Targets: dev (bind-mounted sources), runtime.

FROM node:22-bookworm-slim AS base
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NPM_CONFIG_UPDATE_NOTIFIER=false
# postgresql-client-16 from PGDG: pg_dump must be at least the server's major version.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates openssl curl gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y curl gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The shared package's `prepare` script runs during npm ci even with
# --ignore-scripts (npm links workspaces), so its sources must be present.
COPY packages ./packages
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS dev
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build -w @shiftline/shared && npx -w @shiftline/api prisma generate
EXPOSE 5000
CMD ["npm", "run", "dev", "--workspace", "@shiftline/api"]

FROM dev AS build
RUN npm run build -w @shiftline/api

FROM base AS runtime
ENV NODE_ENV=production
RUN useradd -r -u 10001 shiftline && chown shiftline /app
# Set ownership while copying, avoiding a second full node_modules layer from chown -R.
COPY --chown=10001:10001 --from=deps /app/node_modules ./node_modules
COPY --chown=10001:10001 --from=deps /app/package.json ./package.json
COPY --chown=10001:10001 --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=10001:10001 --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --chown=10001:10001 --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --chown=10001:10001 --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --chown=10001:10001 --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=10001:10001 --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY docker/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER shiftline
EXPOSE 5000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]
