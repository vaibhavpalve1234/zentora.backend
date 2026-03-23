'use strict';

/**
 * Middleware Collection
 *
 * 1. requestId     — inject UUID correlation ID into every req + res header
 * 2. authenticate  — verify JWT Bearer token, attach userId to req
 * 3. errorHandler  — global error handler (must be last middleware)
 * 4. standardLimiter / aiLimiter — rate limiters
 * 5. notFound      — 404 catch-all
 */

const { v4: uuidv4 } = require('uuid');
const rateLimit      = require('express-rate-limit');
const authService    = require('../services/auth.service');
const respond        = require('../utils/respond');
const AppError       = require('../utils/app.error');
const logger         = require('../config/logger');

// ─── 1. Request ID ─────────────────────────────────────────────────────────
function requestId(req, res, next) {
  // Honour upstream proxy ID or generate a fresh one
  const id = req.headers['x-request-id'] || uuidv4();
  req.requestId = id;
  res.setHeader('x-request-id', id);

  // Child logger — every log line from this request carries the ID
  req.log = logger.createRequestLogger(id);
  next();
}

// ─── 2. JWT Authentication ─────────────────────────────────────────────────
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    return respond.error(
      res, 401, 'MISSING_TOKEN', 'Authorization: Bearer <token> header required'
    );
  }

  const token = authHeader.slice(7);

  try {
    const payload    = authService.verifyAccessToken(token);
    req.userId       = payload.sub;
    req.userEmail    = payload.email;
    next();
  } catch (err) {
    return respond.error(
      res,
      err.statusCode || 401,
      err.errorCode  || 'INVALID_TOKEN',
      err.message
    );
  }
}

// ─── 3. Global Error Handler ───────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const rid = req.requestId || 'unknown';

  // ── Operational (expected) errors ──────────────────────────────────────
  if (err.isOperational) {
    logger.warn('Operational error', {
      requestId:  rid,
      code:       err.errorCode,
      message:    err.message,
      statusCode: err.statusCode,
      method:     req.method,
      path:       req.path,
    });

    return respond.error(
      res,
      err.statusCode,
      err.errorCode,
      err.message,
      err.meta || undefined
    );
  }

  // ── MySQL constraint violations ─────────────────────────────────────────
  if (err.code === 'ER_DUP_ENTRY') {
    return respond.error(
      res, 409, 'DUPLICATE_ENTRY',
      'A record with this value already exists'
    );
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return respond.error(
      res, 400, 'INVALID_REFERENCE',
      'Referenced record does not exist'
    );
  }

  if (err.code === 'ER_DATA_TOO_LONG') {
    return respond.error(
      res, 422, 'DATA_TOO_LONG',
      'One or more fields exceed the maximum allowed length'
    );
  }

  // ── JWT errors (not caught inside authService) ──────────────────────────
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return respond.error(res, 401, 'INVALID_TOKEN', err.message);
  }

  // ── Joi validation thrown directly ─────────────────────────────────────
  if (err.isJoi) {
    return respond.error(
      res, 422, 'VALIDATION_ERROR', 'Validation failed', err.details
    );
  }

  // ── Unexpected / programmer error ───────────────────────────────────────
  // Log everything including stack — never expose to client in production
  logger.error('Unexpected server error', {
    requestId: rid,
    message:   err.message,
    stack:     err.stack,
    method:    req.method,
    path:      req.path,
    userId:    req.userId || null,
  });

  const isProd = process.env.NODE_ENV === 'production';

  return respond.error(
    res,
    500,
    'INTERNAL_ERROR',
    isProd ? 'An unexpected error occurred. Please try again.' : err.message
  );
}

// ─── 4. Rate Limiters ──────────────────────────────────────────────────────

/**
 * Standard limiter — applied to all /api/v1 routes.
 * Keyed by userId (authenticated) or IP (unauthenticated).
 */
const standardLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900_000),  // 15 min
  max:      Number(process.env.RATE_LIMIT_MAX        || 100),
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.userId || req.ip,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      requestId: req.requestId,
      userId:    req.userId || null,
      ip:        req.ip,
      path:      req.path,
    });
    respond.error(
      res, 429, 'RATE_LIMITED',
      'Too many requests. Please wait before trying again.'
    );
  },
});

/**
 * AI limiter — stricter limit for Gemini API calls.
 * Prevents accidental cost runups.
 */
const aiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900_000),
  max:      Number(process.env.RATE_LIMIT_AI_MAX    || 20),
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.userId || req.ip,
  handler: (req, res) => {
    logger.warn('AI rate limit exceeded', {
      requestId: req.requestId,
      userId:    req.userId || null,
    });
    respond.error(
      res, 429, 'AI_RATE_LIMITED',
      'Too many AI requests in this window. Please wait 15 minutes.'
    );
  },
});

// ─── 5. 404 Handler ────────────────────────────────────────────────────────
function notFound(req, res) {
  respond.error(
    res, 404, 'NOT_FOUND',
    `Cannot ${req.method} ${req.path}`
  );
}

module.exports = {
  requestId,
  authenticate,
  errorHandler,
  standardLimiter,
  aiLimiter,
  notFound,
};