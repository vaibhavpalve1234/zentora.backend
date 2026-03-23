# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./

# Install production deps only — clean cache to reduce layer size
RUN npm ci --only=production && npm cache clean --force

# ─── Stage 2: Production runtime image ───────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy installed dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (owned by appuser)
COPY --chown=appuser:appgroup . .

# Create logs directory with correct ownership
RUN mkdir -p logs && chown appuser:appgroup logs

# Switch to non-root
USER appuser

# Expose API port
EXPOSE 3000

# Healthcheck — lightweight wget is available in alpine
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/v1/health || exit 1

CMD ["node", "server.js"]