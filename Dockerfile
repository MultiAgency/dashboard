# syntax=docker/dockerfile:1.7

FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --ignore-scripts

# ── Runtime ──
FROM oven/bun:1-alpine
WORKDIR /app

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001

COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/bos.config.json .
COPY --from=builder --chown=appuser:appgroup /app/package.json .
COPY --from=builder --chown=appuser:appgroup /app/bun.lock .
COPY --from=builder --chown=appuser:appgroup /app/bunfig.toml .
COPY --from=builder --chown=appuser:appgroup /app/api ./api
COPY --from=builder --chown=appuser:appgroup /app/ui ./ui

RUN mkdir -p .bos/generated .bos/logs && \
    chown -R appuser:appgroup .bos && \
    chown appuser:appgroup /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

USER appuser
CMD ["sh", "-c", "bun run start"]
