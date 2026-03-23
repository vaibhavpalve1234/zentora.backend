'use strict';

/**
 * Database Migration Runner
 * Usage: node database/migrate.js
 *
 * Reads schema.sql and executes it against MySQL.
 * Idempotent — all CREATE TABLE use IF NOT EXISTS.
 */

require('dotenv').config();

const fs     = require('fs');
const path   = require('path');
const mysql  = require('mysql2/promise');
const logger = require('../src/config/logger');

async function migrate() {
  const conn = await mysql.createConnection({
    host:               process.env.DB_HOST     || 'localhost',
    port:               Number(process.env.DB_PORT) || 3306,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  try {
    logger.info('Running migrations...', { database: process.env.DB_NAME });

    // Create DB if not exists
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    await conn.query(`USE \`${process.env.DB_NAME}\``);

    const sqlPath = path.join(__dirname, 'schema.sql');
    const sql     = fs.readFileSync(sqlPath, 'utf8');

    await conn.query(sql);

    logger.info('✅ Migration completed successfully', {
      database: process.env.DB_NAME,
    });
  } catch (err) {
    logger.error('❌ Migration failed', {
      error:   err.message,
      sqlState: err.sqlState || null,
    });
    throw err;
  } finally {
    await conn.end();
  }
}

migrate().catch(() => process.exit(1));