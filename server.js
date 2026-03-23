'use strict';

/**
 * Server Entry Point
 *
 * Startup sequence:
 *   1. Load environment variables
 *   2. Verify MySQL connection
 *   3. Connect Redis (optional, graceful degradation)
 *   4. Initialise ChromaDB vector store (lazy — happens on first use)
 *   5. Start HTTP server
 *
 * Graceful shutdown on SIGTERM / SIGINT:
 *   - Stop accepting new connections
 *   - Close HTTP server (drain in-flight requests)
 *   - Close DB pool
 *   - Disconnect Redis
 */

require('dotenv').config();

const createApp        = require('./src/app');
const { testConnection, closePool } = require('./src/config/database');
const redis            = require('./src/config/redis');
const logger           = require('./src/config/logger');

const PORT = Number(process.env.PORT) || 3000;

let server;

async function start() {
  try {
    // 1. Database
    await testConnection();

    // 2. Redis (non-blocking)
    await redis.connect();

    // 3. Create Express app
    const app = createApp();

    // 4. Start server
    server = app.listen(PORT, () => {
      logger.info('Money Control Pro API started', {
        port:        PORT,
        environment: process.env.NODE_ENV,
        apiPrefix:   process.env.API_PREFIX || '/api/v1',
        pid:         process.pid,
      });
    });

    // Keep-alive for long-running connections
    server.keepAliveTimeout    = 65_000;
    server.headersTimeout      = 66_000;

  } catch (err) {
    logger.error('Startup failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);

  // Stop accepting new requests
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    logger.info('HTTP server closed');
  }

  // Close resources
  await Promise.allSettled([
    closePool(),
    redis.disconnect(),
  ]);

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled errors — log and exit to let process manager restart
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason?.message || String(reason),
    stack:  reason?.stack,
  });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

start();