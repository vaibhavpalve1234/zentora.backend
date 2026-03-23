'use strict';

/**
 * Redis — optional caching layer
 *
 * Strategy: Cache-aside pattern.
 * If Redis is unavailable the app continues without caching (graceful degradation).
 * All operations are no-ops when Redis is disabled — zero code change in callers.
 */

const { createClient } = require('redis');
const logger = require('./logger');

const {
  REDIS_HOST     = 'localhost',
  REDIS_PORT     = 6379,
  REDIS_PASSWORD = '',
  REDIS_DB       = 0,
  REDIS_TTL_DEFAULT = 3600,
} = process.env;

let client = null;
let isConnected = false;

async function connect() {
  try {
    client = createClient({
      socket: {
        host:           REDIS_HOST,
        port:           Number(REDIS_PORT),
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            logger.warn('Redis: max reconnects reached, disabling cache');
            return false;
          }
          return Math.min(retries * 100, 3000);
        },
      },
      password:  REDIS_PASSWORD || undefined,
      database:  Number(REDIS_DB),
    });

    client.on('error',   (e) => { isConnected = false; logger.warn('Redis error', { error: e.message }); });
    client.on('connect', ()  => { isConnected = true;  logger.info('Redis connected'); });
    client.on('end',     ()  => { isConnected = false; logger.warn('Redis disconnected'); });

    await client.connect();
  } catch (err) {
    isConnected = false;
    logger.warn('Redis unavailable — running without cache', { error: err.message });
  }
}

// ─── Safe wrappers (noop when Redis is down) ──────────────────────────────────

async function get(key) {
  if (!isConnected) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function set(key, value, ttl = Number(REDIS_TTL_DEFAULT)) {
  if (!isConnected) return false;
  try {
    await client.setEx(key, ttl, JSON.stringify(value));
    return true;
  } catch { return false; }
}

async function del(...keys) {
  if (!isConnected) return 0;
  try { return await client.del(keys); }
  catch { return 0; }
}

async function delPattern(pattern) {
  if (!isConnected) return;
  try {
    const keys = await client.keys(pattern);
    if (keys.length) await client.del(keys);
  } catch { /* noop */ }
}

/**
 * Cache-aside helper
 *
 * @param {string} key
 * @param {Function} fetchFn   - async fn that returns fresh data
 * @param {number}  ttl
 */
async function getOrSet(key, fetchFn, ttl = Number(REDIS_TTL_DEFAULT)) {
  const cached = await get(key);
  if (cached !== null) return cached;

  const fresh = await fetchFn();
  await set(key, fresh, ttl);
  return fresh;
}

async function disconnect() {
  if (client && isConnected) {
    await client.quit();
    logger.info('Redis disconnected gracefully');
  }
}

module.exports = {
  connect,
  get,
  set,
  del,
  delPattern,
  getOrSet,
  disconnect,
  isReady: () => isConnected,
};