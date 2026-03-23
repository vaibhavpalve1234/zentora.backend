'use strict';

/**
 * BaseRepository — Repository Pattern
 *
 * SOLID applied:
 *   S — Single responsibility: only data access
 *   O — Open/Closed: extend, don't modify (subclasses add methods)
 *   L — Liskov: all repos can substitute BaseRepository
 *   D — Dependency Inversion: depends on db abstraction, not mysql2 directly
 *
 * Design Pattern: Template Method — find/findById/create/update/delete are
 * defined here; subclasses call super or override as needed.
 */

const { query, transaction } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

class BaseRepository {
  /**
   * @param {string} tableName
   * @param {string[]} allowedColumns  - whitelist for query-building (prevents SQL injection)
   */
  constructor(tableName, allowedColumns = []) {
    if (!tableName) throw new Error('BaseRepository requires a tableName');
    this.tableName      = tableName;
    this.allowedColumns = new Set(allowedColumns);
  }

  // ─── Whitelist guard ───────────────────────────────────────────────────────
  _assertColumn(col) {
    if (!this.allowedColumns.has(col)) {
      throw new Error(`Column "${col}" is not in the allowed list for ${this.tableName}`);
    }
  }

  // ─── Core CRUD ─────────────────────────────────────────────────────────────

  /**
   * Generic SELECT with filters, pagination, and ordering.
   *
   * @param {object} opts
   * @param {object}  opts.where    - { col: val, ... }
   * @param {string}  opts.orderBy  - column name (whitelisted)
   * @param {string}  opts.order    - ASC | DESC
   * @param {number}  opts.limit
   * @param {number}  opts.offset
   * @param {string}  opts.requestId
   */
  async find({
    where     = {},
    orderBy   = 'created_at',
    order     = 'DESC',
    limit     = 50,
    offset    = 0,
    requestId,
  } = {}) {
    const conditions = [];
    const params     = [];

    for (const [col, val] of Object.entries(where)) {
      this._assertColumn(col);
      if (val === null) {
        conditions.push(`\`${col}\` IS NULL`);
      } else if (Array.isArray(val)) {
        conditions.push(`\`${col}\` IN (${val.map(() => '?').join(',')})`);
        params.push(...val);
      } else {
        conditions.push(`\`${col}\` = ?`);
        params.push(val);
      }
    }

    this._assertColumn(orderBy);
    const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const whereSQL  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT * FROM \`${this.tableName}\`
      ${whereSQL}
      ORDER BY \`${orderBy}\` ${safeOrder}
      LIMIT ? OFFSET ?
    `;
    params.push(Number(limit), Number(offset));

    return query(sql, params, { requestId });
  }

  async findById(id, { requestId } = {}) {
    const [row] = await query(
      `SELECT * FROM \`${this.tableName}\` WHERE id = ? LIMIT 1`,
      [id],
      { requestId }
    );
    return row || null;
  }

  async findOne(where = {}, { requestId } = {}) {
    const rows = await this.find({ where, limit: 1, requestId });
    return rows[0] || null;
  }

  /**
   * INSERT a new row.
   * Auto-generates UUID if id is absent.
   *
   * @param {object} data  - column → value map (whitelisted at subclass level)
   * @returns {Promise<object>} the inserted row
   */
  async create(data, { requestId } = {}) {
    const id = data.id || uuidv4();
    const payload = { ...data, id };

    const columns = Object.keys(payload)
      .map(c => `\`${c}\``)
      .join(', ');
    const placeholders = Object.keys(payload).map(() => '?').join(', ');
    const values = Object.values(payload);

    await query(
      `INSERT INTO \`${this.tableName}\` (${columns}) VALUES (${placeholders})`,
      values,
      { requestId }
    );

    return this.findById(id, { requestId });
  }

  /**
   * UPDATE by ID.
   * Only updates provided columns — no blind overwrites.
   */
  async update(id, data, { requestId } = {}) {
    const cleanData = { ...data };
    delete cleanData.id;
    delete cleanData.created_at;

    if (!Object.keys(cleanData).length) {
      throw new Error('update() called with no updatable fields');
    }

    const setClauses = Object.keys(cleanData).map(c => `\`${c}\` = ?`).join(', ');
    const values = [...Object.values(cleanData), id];

    await query(
      `UPDATE \`${this.tableName}\` SET ${setClauses} WHERE id = ?`,
      values,
      { requestId }
    );

    return this.findById(id, { requestId });
  }

  async delete(id, { requestId } = {}) {
    const [result] = await query(
      `DELETE FROM \`${this.tableName}\` WHERE id = ?`,
      [id],
      { requestId }
    );
    return result.affectedRows > 0;
  }

  async count(where = {}, { requestId } = {}) {
    const conditions = [];
    const params = [];
    for (const [col, val] of Object.entries(where)) {
      this._assertColumn(col);
      conditions.push(`\`${col}\` = ?`);
      params.push(val);
    }
    const whereSQL = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [row] = await query(
      `SELECT COUNT(*) AS cnt FROM \`${this.tableName}\` ${whereSQL}`,
      params,
      { requestId }
    );
    return row.cnt;
  }

  // ─── Expose transaction helper ─────────────────────────────────────────────
  transaction(fn, opts) { return transaction(fn, opts); }
}

module.exports = BaseRepository;