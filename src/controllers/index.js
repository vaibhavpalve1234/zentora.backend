'use strict';

/**
 * Controllers — Thin orchestration layer
 *
 * Rule: Controllers ONLY:
 *   1. Extract from req  (body / params / query)
 *   2. Call the service
 *   3. Return via respond helper
 *
 * Zero business logic here. Period.
 */

const respond        = require('../utils/respond');
const authService    = require('../services/auth.service');
const {
  transactionService,
  investmentService,
  loanService,
  budgetService,
} = require('../services');
const insightService = require('../ai/insight.service');

// ═══════════════════════════════════════════════════════════════════════════
// AUTH CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════
const AuthController = {

  async register(req, res, next) {
    try {
      const result = await authService.register(req.body, {
        requestId: req.requestId,
      });

      // Refresh token → HttpOnly cookie (never readable by JS on client)
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
      });

      respond.created(res, {
        user:        result.user,
        accessToken: result.accessToken,
      });
    } catch (err) { next(err); }
  },

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password, {
        requestId: req.requestId,
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   7 * 24 * 60 * 60 * 1000,
      });

      respond.ok(res, {
        user:        result.user,
        accessToken: result.accessToken,
      });
    } catch (err) { next(err); }
  },

  async refresh(req, res, next) {
    try {
      const rawToken = req.cookies?.refreshToken;

      if (!rawToken) {
        return respond.error(
          res, 401, 'MISSING_REFRESH_TOKEN', 'Refresh token required'
        );
      }

      const result = await authService.refreshTokens(rawToken, {
        requestId: req.requestId,
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   7 * 24 * 60 * 60 * 1000,
      });

      respond.ok(res, { accessToken: result.accessToken });
    } catch (err) { next(err); }
  },

  async logout(req, res, next) {
    try {
      const rawToken = req.cookies?.refreshToken;
      await authService.logout(rawToken, { requestId: req.requestId });
      res.clearCookie('refreshToken');
      respond.noContent(res);
    } catch (err) { next(err); }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════
const TransactionController = {

  async create(req, res, next) {
    try {
      const txn = await transactionService.create(
        req.userId, req.body, { requestId: req.requestId }
      );
      respond.created(res, txn);
    } catch (err) { next(err); }
  },

  async list(req, res, next) {
    try {
      const items = await transactionService.list(
        req.userId, req.query, { requestId: req.requestId }
      );
      respond.paginated(res, items, {
        limit:  req.query.limit,
        offset: req.query.offset,
      });
    } catch (err) { next(err); }
  },

  async getById(req, res, next) {
    try {
      const txn = await transactionService.getById(
        req.params.id, req.userId, { requestId: req.requestId }
      );
      respond.ok(res, txn);
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const txn = await transactionService.update(
        req.params.id, req.userId, req.body, { requestId: req.requestId }
      );
      respond.ok(res, txn);
    } catch (err) { next(err); }
  },

  async delete(req, res, next) {
    try {
      await transactionService.delete(
        req.params.id, req.userId, { requestId: req.requestId }
      );
      respond.noContent(res);
    } catch (err) { next(err); }
  },

  async analytics(req, res, next) {
    try {
      const data = await transactionService.getAnalytics(req.userId, {
        ...req.query,
        requestId: req.requestId,
      });
      respond.ok(res, data);
    } catch (err) { next(err); }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// INVESTMENT CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════
const InvestmentController = {

  async create(req, res, next) {
    try {
      const inv = await investmentService.create(
        req.userId, req.body, { requestId: req.requestId }
      );
      respond.created(res, inv);
    } catch (err) { next(err); }
  },

  async list(req, res, next) {
    try {
      const items = await investmentService.list(
        req.userId, req.query, { requestId: req.requestId }
      );
      respond.ok(res, items);
    } catch (err) { next(err); }
  },

  async getById(req, res, next) {
    try {
      const inv = await investmentService.getById(
        req.params.id, req.userId, { requestId: req.requestId }
      );
      respond.ok(res, inv);
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const inv = await investmentService.update(
        req.params.id, req.userId, req.body, { requestId: req.requestId }
      );
      respond.ok(res, inv);
    } catch (err) { next(err); }
  },

  async delete(req, res, next) {
    try {
      await investmentService.delete(
        req.params.id, req.userId, { requestId: req.requestId }
      );
      respond.noContent(res);
    } catch (err) { next(err); }
  },

  async portfolio(req, res, next) {
    try {
      const data = await investmentService.getPortfolio(
        req.userId, { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// LOAN CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════
const LoanController = {

  async create(req, res, next) {
    try {
      const loan = await loanService.create(
        req.userId, req.body, { requestId: req.requestId }
      );
      respond.created(res, loan);
    } catch (err) { next(err); }
  },

  async list(req, res, next) {
    try {
      const items = await loanService.list(
        req.userId, req.query, { requestId: req.requestId }
      );
      respond.ok(res, items);
    } catch (err) { next(err); }
  },

  async getById(req, res, next) {
    try {
      const loan = await loanService.getById(
        req.params.id, req.userId, { requestId: req.requestId }
      );
      respond.ok(res, loan);
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const loan = await loanService.update(
        req.params.id, req.userId, req.body, { requestId: req.requestId }
      );
      respond.ok(res, loan);
    } catch (err) { next(err); }
  },

  async recordPayment(req, res, next) {
    try {
      const result = await loanService.recordPayment(
        req.params.id, req.userId, req.body, { requestId: req.requestId }
      );
      respond.created(res, result);
    } catch (err) { next(err); }
  },

  async dashboard(req, res, next) {
    try {
      const data = await loanService.getDashboard(
        req.userId, { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════
const BudgetController = {

  async create(req, res, next) {
    try {
      const budget = await budgetService.create(
        req.userId, req.body, { requestId: req.requestId }
      );
      respond.created(res, budget);
    } catch (err) { next(err); }
  },

  async list(req, res, next) {
    try {
      const items = await budgetService.list(
        req.userId, { requestId: req.requestId }
      );
      respond.ok(res, items);
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const budget = await budgetService.update(
        req.params.id, req.userId, req.body, { requestId: req.requestId }
      );
      respond.ok(res, budget);
    } catch (err) { next(err); }
  },

  async delete(req, res, next) {
    try {
      await budgetService.delete(
        req.params.id, req.userId, { requestId: req.requestId }
      );
      respond.noContent(res);
    } catch (err) { next(err); }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AI INSIGHT CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════
const AIController = {

  async monthlySummary(req, res, next) {
    try {
      const { year, month } = req.query;
      const data = await insightService.getMonthlySummary(
        req.userId,
        year  ? Number(year)  : undefined,
        month ? Number(month) : undefined,
        { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },

  async detectAnomalies(req, res, next) {
    try {
      const data = await insightService.detectAnomalies(
        req.userId, { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },

  async investmentAdvice(req, res, next) {
    try {
      const data = await insightService.getInvestmentAdvice(
        req.userId, { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },

  async savingsTips(req, res, next) {
    try {
      const data = await insightService.getSavingsTips(
        req.userId, { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },

  async loanAdvice(req, res, next) {
    try {
      const data = await insightService.getLoanAdvice(
        req.userId, { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },

  async customQuery(req, res, next) {
    try {
      const { question } = req.body;
      const data = await insightService.askCustom(
        req.userId, question, { requestId: req.requestId }
      );
      respond.ok(res, data);
    } catch (err) { next(err); }
  },

  async history(req, res, next) {
    try {
      const items = await insightService.getInsightHistory(req.userId, {
        insightType: req.query.type,
        unreadOnly:  req.query.unread === 'true',
        limit:       Number(req.query.limit) || 10,
        requestId:   req.requestId,
      });
      respond.ok(res, items);
    } catch (err) { next(err); }
  },

  async markRead(req, res, next) {
    try {
      await insightService.markRead(
        req.params.id, req.userId, { requestId: req.requestId }
      );
      respond.noContent(res);
    } catch (err) { next(err); }
  },
};

module.exports = {
  AuthController,
  TransactionController,
  InvestmentController,
  LoanController,
  BudgetController,
  AIController,
};