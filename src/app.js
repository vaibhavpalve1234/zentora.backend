'use strict';

/**
 * App Factory
 *
 * Separating app creation from server.listen() allows isolated testing.
 * All global middleware registered here in the correct order:
 *   Security → Parsing → Logging → Request ID → Routes → Error Handling
 */

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const compression  = require('compression');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');

const logger     = require('./config/logger');
const routes     = require('./routes');
const {
  requestId,
  errorHandler,
  standardLimiter,
  notFound,
} = require('./middleware');

const API_PREFIX = process.env.API_PREFIX || '/api/v1';

function createApp() {
  const app = express();

  // ─── 1. Security headers ─────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'"],
        imgSrc:     ["'self'", 'data:'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }));

  // ─── 2. CORS ──────────────────────────────────────────────────────────────
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3001', 'http://localhost:5173'],
    credentials:      true,
    methods:          ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders:   ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders:   ['x-request-id'],
  }));

  // ─── 3. Compression ───────────────────────────────────────────────────────
  app.use(compression({ level: 6, threshold: 1024 }));

  // ─── 4. Body parsing ──────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  // ─── 5. Request ID injection (before logging) ─────────────────────────────
  app.use(requestId);

  // ─── 6. HTTP access logging (Morgan → Winston) ────────────────────────────
  if (process.env.NODE_ENV !== 'test') {
    app.use(
      morgan(
        ':method :url :status :res[content-length] - :response-time ms :req[x-request-id]',
        { stream: logger.stream }
      )
    );
  }

  // ─── 7. Global rate limiting ──────────────────────────────────────────────
  app.use(API_PREFIX, standardLimiter);

  // ─── 8. Routes ────────────────────────────────────────────────────────────
  app.use(API_PREFIX, routes);

  // ─── 9. 404 + Global error handler (MUST be last) ─────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;