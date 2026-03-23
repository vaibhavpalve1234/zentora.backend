'use strict';

/**
 * Business Logic Services
 *
 * Services are the single source of truth for business rules.
 * They orchestrate repositories and emit domain events.
 * Controllers call services; services call repositories.
 *
 * SRP: Each service handles exactly one domain.
 */

const {
  transactionRepository,
  investmentRepository,
  loanRepository,
  budgetRepository,
} = require('../repositories');
const embeddingService = require('../ai/vector/embedding.service');
const cache            = require('../config/redis');
const AppError         = require('../utils/app.error');
const logger           = require('../config/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
class TransactionService {
  async create(userId, dto, { requestId } = {}) {
    const txn = await transactionRepository.create({
      ...dto,
      user_id: userId,
    }, { requestId });

    // Embed in vector store for future RAG (background)
    embeddingService.embedTransactions([{
      ...txn,
      category: dto.category_name || null,
    }], userId, { requestId }).catch(() => {});

    // Invalidate analytics cache
    await cache.delPattern(`analytics:${userId}:*`);
    await cache.delPattern(`insight:${userId}:*`);

    logger.info('Transaction created', { userId, txnId: txn.id, amount: dto.amount, requestId });
    return txn;
  }

  async list(userId, filters, { requestId } = {}) {
    return transactionRepository.findByUser(userId, { ...filters, requestId });
  }

  async getById(id, userId, { requestId } = {}) {
    const txn = await transactionRepository.findById(id, { requestId });
    if (!txn) throw new AppError('Transaction not found', 404, 'TXN_NOT_FOUND');
    if (txn.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    return txn;
  }

  async update(id, userId, dto, { requestId } = {}) {
    await this.getById(id, userId, { requestId });  // ownership check

    // Don't allow changing user_id
    delete dto.user_id;

    const updated = await transactionRepository.update(id, dto, { requestId });
    await cache.delPattern(`analytics:${userId}:*`);
    return updated;
  }

  async delete(id, userId, { requestId } = {}) {
    await this.getById(id, userId, { requestId });
    await transactionRepository.delete(id, { requestId });
    await cache.delPattern(`analytics:${userId}:*`);
    logger.info('Transaction deleted', { userId, txnId: id, requestId });
    return { message: 'Transaction deleted' };
  }

  async getAnalytics(userId, { year, month, startDate, endDate, requestId } = {}) {
    const cacheKey = `analytics:${userId}:${year}:${month}`;
    return cache.getOrSet(cacheKey, async () => {
      const now = new Date();
      const y = year  || now.getFullYear();
      const m = month || now.getMonth() + 1;

      const [summary, breakdown, trend, savingsRate, topDays] = await Promise.all([
        transactionRepository.getMonthlySummary(userId, y, m, { requestId }),
        transactionRepository.getCategoryBreakdown(userId, {
          startDate: startDate || `${y}-${String(m).padStart(2, '0')}-01`,
          endDate:   endDate   || `${y}-${String(m).padStart(2, '0')}-31`,
          requestId,
        }),
        transactionRepository.getMonthlyTrend(userId, 6, { requestId }),
        transactionRepository.getSavingsRate(userId, y, m, { requestId }),
        transactionRepository.getTopSpendingDays(userId, {
          startDate: `${y}-${String(m).padStart(2, '0')}-01`,
          endDate:   `${y}-${String(m).padStart(2, '0')}-31`,
          requestId,
        }),
      ]);

      return { summary, breakdown, trend, savingsRate, topDays, year: y, month: m };
    }, 1800);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTMENT SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
class InvestmentService {
  async create(userId, dto, { requestId } = {}) {
    const investment = await investmentRepository.create({
      ...dto,
      user_id:       userId,
      current_value: dto.current_value || dto.invested_amount,
    }, { requestId });

    await cache.delPattern(`insight:${userId}:investment*`);
    logger.info('Investment created', { userId, id: investment.id, type: dto.type, requestId });
    return investment;
  }

  async list(userId, filters, { requestId } = {}) {
    return investmentRepository.findByUser(userId, { ...filters, requestId });
  }

  async getById(id, userId, { requestId } = {}) {
    const inv = await investmentRepository.findById(id, { requestId });
    if (!inv)               throw new AppError('Investment not found', 404, 'INV_NOT_FOUND');
    if (inv.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    return inv;
  }

  async update(id, userId, dto, { requestId } = {}) {
    await this.getById(id, userId, { requestId });
    delete dto.user_id;
    return investmentRepository.update(id, dto, { requestId });
  }

  async delete(id, userId, { requestId } = {}) {
    await this.getById(id, userId, { requestId });
    await investmentRepository.delete(id, { requestId });
    return { message: 'Investment deleted' };
  }

  async getPortfolio(userId, { requestId } = {}) {
    const cacheKey = `portfolio:${userId}`;
    return cache.getOrSet(cacheKey, async () => {
      const [summary, total, sips] = await Promise.all([
        investmentRepository.getPortfolioSummary(userId, { requestId }),
        investmentRepository.getTotalPortfolioValue(userId, { requestId }),
        investmentRepository.getSIPList(userId, { requestId }),
      ]);
      return { summary, total, sips };
    }, 900);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAN SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
class LoanService {
  async create(userId, dto, { requestId } = {}) {
    const loan = await loanRepository.create({
      ...dto,
      user_id:     userId,
      outstanding: dto.outstanding || dto.principal,
    }, { requestId });
    logger.info('Loan created', { userId, id: loan.id, direction: dto.direction, requestId });
    return loan;
  }

  async list(userId, filters, { requestId } = {}) {
    return loanRepository.findByUser(userId, { ...filters, requestId });
  }

  async getById(id, userId, { requestId } = {}) {
    const loan = await loanRepository.findById(id, { requestId });
    if (!loan)               throw new AppError('Loan not found', 404, 'LOAN_NOT_FOUND');
    if (loan.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    return loan;
  }

  async update(id, userId, dto, { requestId } = {}) {
    await this.getById(id, userId, { requestId });
    delete dto.user_id;
    return loanRepository.update(id, dto, { requestId });
  }

  async recordPayment(loanId, userId, paymentDto, { requestId } = {}) {
    const loan = await this.getById(loanId, userId, { requestId });
    if (!['active', 'partially_paid'].includes(loan.status)) {
      throw new AppError('Loan is already closed', 400, 'LOAN_CLOSED');
    }
    if (paymentDto.amount > loan.outstanding) {
      throw new AppError('Payment exceeds outstanding balance', 400, 'EXCESS_PAYMENT');
    }

    return loanRepository.recordPayment(loanId, {
      ...paymentDto,
      user_id: userId,
    }, { requestId });
  }

  async getDashboard(userId, { requestId } = {}) {
    const [summary, overdue, dueSoon] = await Promise.all([
      loanRepository.getLoanSummary(userId, { requestId }),
      loanRepository.getOverdueLoans(userId, { requestId }),
      loanRepository.getDueInDays(userId, 30, { requestId }),
    ]);

    const totalBorrowed = summary.find(s => s.direction === 'borrowed')?.total_outstanding || 0;
    const totalLent     = summary.find(s => s.direction === 'lent')?.total_outstanding     || 0;
    const netDebt       = totalBorrowed - totalLent;

    return { summary, overdue, dueSoon, netDebt, totalBorrowed, totalLent };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUDGET SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
class BudgetService {
  async create(userId, dto, { requestId } = {}) {
    const budget = await budgetRepository.create({ ...dto, user_id: userId }, { requestId });
    await cache.del(`budgets:${userId}`);
    return budget;
  }

  async list(userId, { requestId } = {}) {
    const cacheKey = `budgets:${userId}`;
    return cache.getOrSet(cacheKey, () =>
      budgetRepository.getBudgetUtilization(userId, { requestId }),
      300
    );
  }

  async update(id, userId, dto, { requestId } = {}) {
    const budget = await budgetRepository.findById(id, { requestId });
    if (!budget)                 throw new AppError('Budget not found', 404, 'BUDGET_NOT_FOUND');
    if (budget.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    delete dto.user_id;
    const updated = await budgetRepository.update(id, dto, { requestId });
    await cache.del(`budgets:${userId}`);
    return updated;
  }

  async delete(id, userId, { requestId } = {}) {
    const budget = await budgetRepository.findById(id, { requestId });
    if (!budget)                 throw new AppError('Budget not found', 404, 'BUDGET_NOT_FOUND');
    if (budget.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    await budgetRepository.delete(id, { requestId });
    await cache.del(`budgets:${userId}`);
    return { message: 'Budget deleted' };
  }
}

module.exports = {
  transactionService: new TransactionService(),
  investmentService:  new InvestmentService(),
  loanService:        new LoanService(),
  budgetService:      new BudgetService(),
};