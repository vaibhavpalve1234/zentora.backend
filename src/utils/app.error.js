'use strict';

/**
 * AppError — Structured operational error
 *
 * Throw AppError for any intentional, expected business error.
 * The global errorHandler checks err.isOperational to decide
 * whether to send the real message to the client or hide it.
 *
 * Usage:
 *   throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
 *   throw new AppError('Forbidden', 403, 'FORBIDDEN');
 *   throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
 */

class AppError extends Error {
  /**
   * @param {string}  message     Human-readable description
   * @param {number}  statusCode  HTTP status code (400, 401, 403, 404, 409, 422…)
   * @param {string}  errorCode   Machine-readable code for client logic
   * @param {object|null} meta    Optional extra data (safe to send to client)
   */
  constructor(
    message,
    statusCode = 500,
    errorCode  = 'INTERNAL_ERROR',
    meta       = null
  ) {
    super(message);

    this.name          = 'AppError';
    this.statusCode    = statusCode;
    this.errorCode     = errorCode;
    this.meta          = meta;
    this.isOperational = true;  // Signals: safe to expose message to client

    // Preserve the V8 stack trace, excluding AppError constructor frame
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

// ─── Convenience factories ──────────────────────────────────────────────────
AppError.notFound    = (msg = 'Resource not found')   => new AppError(msg, 404, 'NOT_FOUND');
AppError.forbidden   = (msg = 'Access denied')         => new AppError(msg, 403, 'FORBIDDEN');
AppError.unauthorized= (msg = 'Authentication required')=> new AppError(msg, 401, 'UNAUTHORIZED');
AppError.conflict    = (msg = 'Resource already exists')=> new AppError(msg, 409, 'CONFLICT');
AppError.badRequest  = (msg = 'Bad request', meta = null)=> new AppError(msg, 400, 'BAD_REQUEST', meta);
AppError.unprocessable=(msg = 'Validation failed', meta = null)=> new AppError(msg, 422, 'VALIDATION_ERROR', meta);

module.exports = AppError;