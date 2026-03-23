'use strict';

/**
 * Investment / Loan / Budget / User Repositories
 * Each exported as singleton (module-level) instances.
 */

const BaseRepository = require('./base.repository');
const { query }      = require('../config/database');

// ═══════════════════════════════════════════════════════════════════════════════
// USER REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════
class UserRepository extends BaseRepository {
  constructor() {
    super('users', [
      'id','email','password_hash','full_name','currency',
      'timezone','is_active','created_at','updated_at',
    ]);
  }

  async findByEmail(email, { requestId } = {}) {
    const [row] = await query(
      `SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1`,
      [email],
      { requestId }
    );
    return row || null;
  }

  async findActiveById(id, { requestId } = {}) {
    const [row] = await query(
      `SELECT id, email, full_name, currency, timezone, created_at
       FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [id],
      { requestId }
    );
    return row || null;
  }

  async updateLastLogin(id, { requestId } = {}) {
    return query(
      `UPDATE users SET updated_at = NOW() WHERE id = ?`,
      [id],
      { requestId }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTMENT REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════
class InvestmentRepository extends BaseRepository {
  constructor() {
    super('investments', [
      'id','user_id','type','name','symbol','invested_amount','current_value',
      'units','avg_buy_price','start_date','maturity_date','sip_amount',
      'sip_frequency','status','notes','meta','created_at','updated_at',
    ]);
  }

  async findByUser(userId, { type, status, requestId } = {}) {
    const params  = [userId];
    const clauses = ['user_id = ?'];
    if (type)   { clauses.push('type = ?');   params.push(type); }
    if (status) { clauses.push('status = ?'); params.push(status); }

    return query(
      `SELECT * FROM investments WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      params,
      { requestId }
    );
  }

  async getPortfolioSummary(userId, { requestId } = {}) {
    const sql = `
      SELECT
        type,
        COUNT(*)                AS count,
        SUM(invested_amount)    AS total_invested,
        SUM(current_value)      AS total_current_value,
        SUM(current_value - invested_amount) AS total_pnl,
        ROUND(
          (SUM(current_value) - SUM(invested_amount)) * 100.0 /
          NULLIF(SUM(invested_amount), 0),
        2) AS pnl_percentage
      FROM investments
      WHERE user_id = ? AND status IN ('active','paused')
      GROUP BY type
    `;
    return query(sql, [userId], { requestId });
  }

  async getTotalPortfolioValue(userId, { requestId } = {}) {
    const [row] = await query(
      `SELECT
         SUM(invested_amount) AS total_invested,
         SUM(current_value)   AS total_current_value
       FROM investments
       WHERE user_id = ? AND status IN ('active','paused')`,
      [userId],
      { requestId }
    );
    return row;
  }

  async getSIPList(userId, { requestId } = {}) {
    return query(
      `SELECT * FROM investments
       WHERE user_id = ? AND type = 'sip' AND status = 'active'
       ORDER BY sip_amount DESC`,
      [userId],
      { requestId }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAN REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════
class LoanRepository extends BaseRepository {
  constructor() {
    super('loans', [
      'id','user_id','direction','party_name','party_contact','principal',
      'interest_rate','interest_type','outstanding','start_date','due_date',
      'purpose','status','reminder_days','notes','created_at','updated_at',
    ]);
  }

  async findByUser(userId, { direction, status, requestId } = {}) {
    const params  = [userId];
    const clauses = ['user_id = ?'];
    if (direction) { clauses.push('direction = ?'); params.push(direction); }
    if (status)    { clauses.push('status = ?');    params.push(status); }

    return query(
      `SELECT * FROM loans WHERE ${clauses.join(' AND ')} ORDER BY due_date ASC NULLS LAST`,
      params,
      { requestId }
    );
  }

  async getLoanSummary(userId, { requestId } = {}) {
    const sql = `
      SELECT
        direction,
        COUNT(*)           AS count,
        SUM(principal)     AS total_principal,
        SUM(outstanding)   AS total_outstanding
      FROM loans
      WHERE user_id = ? AND status IN ('active','partially_paid')
      GROUP BY direction
    `;
    return query(sql, [userId], { requestId });
  }

  async getOverdueLoans(userId, { requestId } = {}) {
    return query(
      `SELECT * FROM loans
       WHERE user_id = ?
         AND status IN ('active','partially_paid')
         AND due_date < CURDATE()
       ORDER BY due_date ASC`,
      [userId],
      { requestId }
    );
  }

  async getDueInDays(userId, days = 7, { requestId } = {}) {
    return query(
      `SELECT * FROM loans
       WHERE user_id = ?
         AND status IN ('active','partially_paid')
         AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY due_date ASC`,
      [userId, days],
      { requestId }
    );
  }

  // Record a repayment and reduce outstanding
  async recordPayment(loanId, paymentData, { requestId } = {}) {
    return this.transaction(async (conn) => {
      // Insert payment record
      const [ins] = await conn.execute(
        `INSERT INTO loan_payments
           (id, loan_id, user_id, amount, payment_date,
            principal_component, interest_component, notes)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
        [
          loanId,
          paymentData.user_id,
          paymentData.amount,
          paymentData.payment_date,
          paymentData.principal_component || paymentData.amount,
          paymentData.interest_component  || 0,
          paymentData.notes               || null,
        ]
      );

      // Reduce outstanding
      await conn.execute(
        `UPDATE loans
         SET outstanding = GREATEST(0, outstanding - ?),
             status = CASE
               WHEN outstanding - ? <= 0 THEN 'paid'
               ELSE status
             END
         WHERE id = ?`,
        [paymentData.amount, paymentData.amount, loanId]
      );

      return ins;
    }, { requestId });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUDGET REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════
class BudgetRepository extends BaseRepository {
  constructor() {
    super('budgets', [
      'id','user_id','category_id','name','amount','period',
      'start_date','end_date','alert_at','is_active','created_at','updated_at',
    ]);
  }

  async findActive(userId, { requestId } = {}) {
    return query(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon
       FROM budgets b
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.user_id = ?
         AND b.is_active = 1
         AND (b.end_date IS NULL OR b.end_date >= CURDATE())
       ORDER BY b.amount DESC`,
      [userId],
      { requestId }
    );
  }

  /**
   * Returns budgets with spending totals for the current period.
   * Uses a lateral JOIN-style subquery for MySQL 8+.
   */
  async getBudgetUtilization(userId, { requestId } = {}) {
    const sql = `
      SELECT
        b.id,
        b.name,
        b.amount     AS budget_amount,
        b.period,
        b.alert_at,
        c.name       AS category_name,
        COALESCE(
          (SELECT SUM(t.amount)
           FROM transactions t
           WHERE t.user_id     = b.user_id
             AND (t.category_id = b.category_id OR b.category_id IS NULL)
             AND t.type        = 'expense'
             AND t.transaction_date >= CASE b.period
               WHEN 'monthly'  THEN DATE_FORMAT(CURDATE(),'%Y-%m-01')
               WHEN 'weekly'   THEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
               WHEN 'yearly'   THEN DATE_FORMAT(CURDATE(),'%Y-01-01')
               ELSE CURDATE()
             END
          ), 0) AS spent_amount,
        ROUND(
          COALESCE(
            (SELECT SUM(t.amount)
             FROM transactions t
             WHERE t.user_id = b.user_id
               AND (t.category_id = b.category_id OR b.category_id IS NULL)
               AND t.type = 'expense'
               AND t.transaction_date >= CASE b.period
                 WHEN 'monthly'  THEN DATE_FORMAT(CURDATE(),'%Y-%m-01')
                 WHEN 'weekly'   THEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
                 WHEN 'yearly'   THEN DATE_FORMAT(CURDATE(),'%Y-01-01')
                 ELSE CURDATE()
               END
            ), 0) * 100.0 / NULLIF(b.amount, 0),
        2) AS utilization_pct
      FROM budgets b
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.user_id = ? AND b.is_active = 1
      ORDER BY utilization_pct DESC
    `;
    return query(sql, [userId], { requestId });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI INSIGHT REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════
class InsightRepository extends BaseRepository {
  constructor() {
    super('ai_insights', [
      'id','user_id','insight_type','title','content','context_hash',
      'prompt_tokens','model_used','is_read','generated_at','expires_at',
    ]);
  }

  async findByUser(userId, { insightType, unreadOnly, limit = 10, requestId } = {}) {
    const params  = [userId];
    const clauses = ['user_id = ?'];
    if (insightType) { clauses.push('insight_type = ?'); params.push(insightType); }
    if (unreadOnly)  { clauses.push('is_read = 0'); }

    params.push(Number(limit));
    return query(
      `SELECT * FROM ai_insights
       WHERE ${clauses.join(' AND ')}
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY generated_at DESC
       LIMIT ?`,
      params,
      { requestId }
    );
  }

  async existsByContextHash(userId, hash, { requestId } = {}) {
    const [row] = await query(
      `SELECT id FROM ai_insights
       WHERE user_id = ? AND context_hash = ?
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [userId, hash],
      { requestId }
    );
    return !!row;
  }
}

module.exports = {
  userRepository:        new UserRepository(),
  transactionRepository: require('./transaction.repository'),
  investmentRepository:  new InvestmentRepository(),
  loanRepository:        new LoanRepository(),
  budgetRepository:      new BudgetRepository(),
  insightRepository:     new InsightRepository(),
};