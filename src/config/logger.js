'use strict';

/**
 * Logger — Winston + Daily Rotate File
 *
 * Design decisions:
 * - Structured JSON in production  →  easy Elasticsearch / Splunk ingest
 * - Human-readable colorized in dev →  developer experience
 * - Separate error.log stream       →  ops alerting
 * - Request ID correlation          →  traceability across async calls
 * - Never log sensitive fields      →  security compliance
 */

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, errors, json, printf, colorize, splat } = format;

// ─── Sensitive field scrubber ─────────────────────────────────────────────────
const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'token', 'access_token',
  'refresh_token', 'token_hash', 'authorization', 'api_key',
  'gemini_api_key', 'secret',
]);

function scrubSensitive(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => scrubSensitive(v, depth + 1));

  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : scrubSensitive(v, depth + 1),
    ])
  );
}

const sanitizeFormat = format((info) => {
  if (info.meta)    info.meta    = scrubSensitive(info.meta);
  if (info.request) info.request = scrubSensitive(info.request);
  return info;
});

// ─── Formats ──────────────────────────────────────────────────────────────────
const productionFormat = combine(
  sanitizeFormat(),
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  errors({ stack: true }),
  splat(),
  json()
);

const developmentFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  printf(({ level, message, timestamp, requestId, stack, ...rest }) => {
    const rid = requestId ? ` [${requestId}]` : '';
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp}${rid} ${level}: ${stack || message}${extra}`;
  })
);

// ─── Transports ───────────────────────────────────────────────────────────────
const LOG_DIR  = process.env.LOG_DIR  || './logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const fileRotateOptions = {
  datePattern: 'YYYY-MM-DD',
  maxSize:     process.env.LOG_MAX_SIZE  || '20m',
  maxFiles:    process.env.LOG_MAX_FILES || '14d',
  zippedArchive: true,
};

function buildTransports() {
  const list = [];

  if (process.env.NODE_ENV !== 'test') {
    list.push(
      new transports.DailyRotateFile({
        ...fileRotateOptions,
        filename: path.join(LOG_DIR, 'combined-%DATE%.log'),
        level: LOG_LEVEL,
      }),
      new transports.DailyRotateFile({
        ...fileRotateOptions,
        filename: path.join(LOG_DIR, 'error-%DATE%.log'),
        level: 'error',
      })
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    list.push(new transports.Console());
  } else {
    // In production still emit to stdout for container log drivers
    list.push(new transports.Console({ silent: false }));
  }

  return list;
}

// ─── Logger instance ──────────────────────────────────────────────────────────
const logger = createLogger({
  level:       LOG_LEVEL,
  format:      process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  transports:  buildTransports(),
  exitOnError: false,
});

// ─── Child logger factory (per-request context) ───────────────────────────────
/**
 * createRequestLogger(requestId, userId?)
 * Returns a child logger that automatically attaches context fields to every
 * log line — critical for correlating logs across async await chains.
 */
logger.createRequestLogger = (requestId, userId = null) =>
  logger.child({ requestId, ...(userId && { userId }) });

// ─── Stream for Morgan HTTP logging ───────────────────────────────────────────
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;