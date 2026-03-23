'use strict';

/**
 * Database — MySQL2 connection pool
 *
 * Uses mysql2/promise for async/await.
 * Exposes:
 *   pool         → raw pool (for advanced use)
 *   query()      → single-row/multi-row query with automatic logging
 *   transaction()→ managed transaction with auto-rollback on error
 */

const mysql  = require('mysql2/promise');
const logger = require('./logger');

const {
  DB_HOST     = 'localhost',
  DB_PORT     = 3306,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_POOL_MIN = 2,
  DB_POOL_MAX = 10,
  DB_ACQUIRE_TIMEOUT = 30000,
  DB_IDLE_TIMEOUT    = 10000,
} = process.env;

// ─── Pool ─────────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               DB_HOST,
  port:               Number(DB_PORT),
  database:           DB_NAME,
  user:               DB_USER,
  password:           DB_PASSWORD,

  // Pool sizing
  connectionLimit:    Number(DB_POOL_MAX),
  waitForConnections: true,
  queueLimit:         0,

  // Timings
  connectTimeout:     Number(DB_ACQUIRE_TIMEOUT),
  idleTimeout:        Number(DB_IDLE_TIMEOUT),

  // Reliability
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,

  // Charset
  charset: 'utf8mb4',

  // Auto-parse DATE/DATETIME columns as strings to avoid timezone surprises
  dateStrings: true,

  // Named placeholders support
  namedPlaceholders: true,

  // Return numbers instead of strings for numeric columns
  typeCast(field, next) {
    if (field.type === 'TINY' && field.length === 1) {
      return field.string() === '1';
    }
    if (['DECIMAL', 'NEWDECIMAL'].includes(field.type)) {
      const val = field.string();
      return val === null ? null : parseFloat(val);
    }
    return next();
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Execute a parameterised query on the pool.
 *
 * @param {string} sql        - SQL with :named or ? placeholders
 * @param {object|Array} params
 * @param {object}  opts
 * @param {string}  opts.requestId  - correlation ID for logging
 * @returns {Promise<Array>}  rows
 */
async function query(sql, params = [], { requestId } = {}) {
  const start = Date.now();
  try {
    const [rows] = await pool.execute(sql, params);
    logger.debug('DB query', {
      requestId,
      sql: sql.replace(/\s+/g, ' ').slice(0, 200),
      rowCount: rows.length,
      durationMs: Date.now() - start,
    });
    return rows;
  } catch (err) {
    logger.error('DB query error', {
      requestId,
      sql: sql.replace(/\s+/g, ' ').slice(0, 200),
      errorCode: err.code,
      durationMs: Date.now() - start,
    });
    throw err;
  }
}

/**
 * Run multiple operations inside a single transaction.
 * Auto-commits on success, auto-rollbacks on any thrown error.
 *
 * Usage:
 *   const result = await transaction(async (conn) => {
 *     await conn.execute('INSERT ...', [...]);
 *     return await conn.execute('SELECT ...', [...]);
 *   });
 */
async function transaction(fn, { requestId } = {}) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    logger.debug('DB transaction committed', { requestId });
    return result;
  } catch (err) {
    await conn.rollback();
    logger.error('DB transaction rolled back', { requestId, error: err.message });
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Graceful shutdown — drain the pool on SIGTERM/SIGINT
 */
async function closePool() {
  try {
    await pool.end();
    logger.info('DB pool closed gracefully');
  } catch (err) {
    logger.error('DB pool close error', { error: err.message });
  }
}

// ─── Verify connectivity at startup ───────────────────────────────────────────
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    logger.info('MySQL connection established', { host: DB_HOST, db: DB_NAME });
  } catch (err) {
    logger.error('MySQL connection FAILED', { error: err.message });
    throw err;
  }
}

module.exports = { pool, query, transaction, closePool, testConnection };