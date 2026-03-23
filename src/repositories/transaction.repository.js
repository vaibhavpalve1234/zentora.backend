'use strict';

/**
 * TransactionRepository
 *
 * All optimized queries use covering indexes defined in schema.sql.
 * Analytics queries use MySQL's built-in date functions with the
 * idx_txn_analytics composite index.
 */

const BaseRepository = require('./base.repository');
const { query }      = require('../config/database');

class TransactionRepository extends BaseRepository {
  constructor() {
    super('transactions', [
      'id','user_id','category_id','type','amount','currency',
      'description','tags','transaction_date','payment_method',
      'is_recurring','recurrence_rule','created_at','updated_at',
    ]);
  }

  // ─── Paginated list for a user ─────────────────────────────────────────────
  async findByUser(userId, { type, categoryId, startDate, endDate, limit = 50, offset = 0, requestId } = {}) {
    const params = [userId];
    const clauses = ['t.user_id = ?'];

    if (type)       { clauses.push('t.type = ?');                  params.push(type); }
    if (categoryId) { clauses.push('t.category_id = ?');           params.push(categoryId); }
    if (startDate)  { clauses.push('t.transaction_date >= ?');     params.push(startDate); }
    if (endDate)    { clauses.push('t.transaction_date <= ?');     params.push(endDate); }

    const sql = `
      SELECT
        t.*,
        c.name   AS category_name,
        c.icon   AS category_icon,
        c.color  AS category_color
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(Number(limit), Number(offset));
    return query(sql, params, { requestId });
  }

  // ─── Monthly summary (uses idx_txn_analytics) ──────────────────────────────
  async getMonthlySummary(userId, year, month, { requestId } = {}) {
    const sql = `
      SELECT
        type,
        COUNT(*)                AS txn_count,
        SUM(amount)             AS total_amount,
        AVG(amount)             AS avg_amount,
        MIN(amount)             AS min_amount,
        MAX(amount)             AS max_amount
      FROM transactions
      WHERE user_id = ?
        AND YEAR(transaction_date)  = ?
        AND MONTH(transaction_date) = ?
      GROUP BY type
    `;
    return query(sql, [userId, year, month], { requestId });
  }

  // ─── Category breakdown ────────────────────────────────────────────────────
  async getCategoryBreakdown(userId, { startDate, endDate, type = 'expense', requestId } = {}) {
    const sql = `
      SELECT
        COALESCE(c.name, 'Uncategorized') AS category,
        c.icon,
        c.color,
        COUNT(t.id)   AS txn_count,
        SUM(t.amount) AS total_amount,
        ROUND(
          SUM(t.amount) * 100.0 /
          NULLIF(SUM(SUM(t.amount)) OVER (), 0),
        2) AS percentage
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ?
        AND t.type    = ?
        AND t.transaction_date BETWEEN ? AND ?
      GROUP BY t.category_id, c.name, c.icon, c.color
      ORDER BY total_amount DESC
    `;
    return query(sql, [userId, type, startDate, endDate], { requestId });
  }

  // ─── Monthly trend (last N months) ────────────────────────────────────────
  async getMonthlyTrend(userId, months = 6, { requestId } = {}) {
    const sql = `
      SELECT
        DATE_FORMAT(transaction_date, '%Y-%m') AS month,
        type,
        SUM(amount) AS total
      FROM transactions
      WHERE user_id = ?
        AND transaction_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      GROUP BY month, type
      ORDER BY month ASC
    `;
    return query(sql, [userId, months], { requestId });
  }

  // ─── Savings rate calculation ──────────────────────────────────────────────
  async getSavingsRate(userId, year, month, { requestId } = {}) {
    const sql = `
      SELECT
        SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END) AS total_income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense
      FROM transactions
      WHERE user_id = ?
        AND YEAR(transaction_date)  = ?
        AND MONTH(transaction_date) = ?
    `;
    const [row] = await query(sql, [userId, year, month], { requestId });
    const income  = row?.total_income  || 0;
    const expense = row?.total_expense || 0;
    const savings = income - expense;
    const rate    = income > 0 ? ((savings / income) * 100).toFixed(2) : 0;
    return { income, expense, savings: Math.max(0, savings), savingsRate: Number(rate) };
  }

  // ─── Top spending days ─────────────────────────────────────────────────────
  async getTopSpendingDays(userId, { startDate, endDate, limit = 5, requestId } = {}) {
    const sql = `
      SELECT
        transaction_date,
        SUM(amount)  AS total_spent,
        COUNT(*)     AS txn_count
      FROM transactions
      WHERE user_id = ?
        AND type    = 'expense'
        AND transaction_date BETWEEN ? AND ?
      GROUP BY transaction_date
      ORDER BY total_spent DESC
      LIMIT ?
    `;
    return query(sql, [userId, startDate, endDate, limit], { requestId });
  }

  // ─── Recent transactions (used for AI context) ────────────────────────────
  async getRecentForAI(userId, limit = 30, { requestId } = {}) {
    const sql = `
      SELECT
        t.type,
        t.amount,
        t.transaction_date,
        t.description,
        t.payment_method,
        COALESCE(c.name, 'Uncategorized') AS category
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ?
      ORDER BY t.transaction_date DESC
      LIMIT ?
    `;
    return query(sql, [userId, limit], { requestId });
  }
}

module.exports = new TransactionRepository();