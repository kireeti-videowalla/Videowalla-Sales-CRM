# Multi-stage build. The same image runs both the web app and the worker —
# docker-compose just gives them different commands.

FROM node:22-slim AS base
# Prisma needs OpenSSL at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Dependencies ---------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- Build ----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client must be generated before next build.
RUN npx prisma generate && npm run build

# ---- Runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/.next        ./.next
COPY --from=build /app/public       ./public
COPY --from=build /app/prisma       ./prisma
COPY --from=build /app/src          ./src
COPY --from=build /app/scripts      ./scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json  ./tsconfig.json

RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
