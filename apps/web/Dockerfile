# Playwright base image (Ubuntu Jammy based)
FROM mcr.microsoft.com/playwright:v1.47.0-jammy AS base
RUN npm install -g pnpm@11
WORKDIR /app

# Dependencies
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# Add package copies as needed for monorepo
COPY packages/scrapers/package.json ./packages/scrapers/
COPY apps/web/package.json ./apps/web/
# In a real monorepo we'd copy all package.jsons to ensure workspaces link correctly
# Running install
RUN pnpm install --frozen-lockfile

# Builder
FROM deps AS builder
COPY . .
# We must generate prisma client before build
RUN pnpm --filter @codeon/web exec prisma generate
RUN pnpm build --filter @codeon/web...

# Production
FROM base AS production
# We don't drop to non-root here if Playwright needs root for sandboxing,
# or we use a specific user provided by the Playwright image (pwuser).
# Playwright image has `pwuser` created.
WORKDIR /app

COPY --from=builder --chown=pwuser:pwuser /app/apps/web/.next/standalone ./
COPY --from=builder --chown=pwuser:pwuser /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=pwuser:pwuser /app/apps/web/public ./apps/web/public

USER pwuser
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Note: GEMINI_API_KEY and REDIS_URL must be provided at runtime.
CMD ["node", "apps/web/server.js"]
