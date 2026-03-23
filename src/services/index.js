'use strict';

const {
  transactionRepository,
  investmentRepository,
  loanRepository,
  budgetRepository,
} = require('../repositories');
const embeddingService = require('../ai/vector/embedding.service');
const cache = require('../config/redis');
const AppError = require('../utils/app.error');
const logger = require('../config/logger');
const { encryptEntity, decryptEntity } = require('../crypto');

function mapDecrypted(entityName, rows, dek) {
  return rows.map((row) => decryptEntity(entityName, row, dek));
}

class TransactionService {
  async create(userId, dto, { requestId, dek, ipAddress } = {}) {
    const txn = await transactionRepository.create(
      encryptEntity('transactions', { ...dto, user_id: userId }, dek, process.env.BLIND_INDEX_SECRET),
      { requestId }
    );

    const decryptedTxn = decryptEntity('transactions', txn, dek);
    embeddingService.embedTransactions([{ ...decryptedTxn, category: dto.category_name || null }], userId, { requestId }).catch(() => {});

    await cache.delPattern(`analytics:${userId}:*`);
    await cache.delPattern(`insight:${userId}:*`);

    logger.info('Transaction created', { userId, txnId: txn.id, amount: dto.amount, requestId, ipAddress });
    return decryptedTxn;
  }

  async list(userId, filters, { requestId, dek } = {}) {
    const rows = await transactionRepository.findByUser(userId, { ...filters, requestId });
    return mapDecrypted('transactions', rows, dek);
  }

  async getById(id, userId, { requestId, dek } = {}) {
    const txn = await transactionRepository.findById(id, { requestId });
    if (!txn) throw new AppError('Transaction not found', 404, 'TXN_NOT_FOUND');
    if (txn.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    return decryptEntity('transactions', txn, dek);
  }

  async update(id, userId, dto, { requestId, dek, ipAddress } = {}) {
    await this.getById(id, userId, { requestId, dek });
    delete dto.user_id;
    const updated = await transactionRepository.update(id, encryptEntity('transactions', dto, dek, process.env.BLIND_INDEX_SECRET), { requestId });
    await cache.delPattern(`analytics:${userId}:*`);
    logger.info('Transaction updated', { userId, txnId: id, requestId, ipAddress });
    return decryptEntity('transactions', updated, dek);
  }

  async delete(id, userId, { requestId, dek, ipAddress } = {}) {
    await this.getById(id, userId, { requestId, dek });
    await transactionRepository.delete(id, { requestId });
    await cache.delPattern(`analytics:${userId}:*`);
    logger.info('Transaction deleted', { userId, txnId: id, requestId, ipAddress });
    return { message: 'Transaction deleted' };
  }

  async getAnalytics(userId, { year, month, startDate, endDate, requestId } = {}) {
    const cacheKey = `analytics:${userId}:${year}:${month}`;
    return cache.getOrSet(cacheKey, async () => {
      const now = new Date();
      const y = year || now.getFullYear();
      const m = month || now.getMonth() + 1;

      const [summary, breakdown, trend, savingsRate, topDays] = await Promise.all([
        transactionRepository.getMonthlySummary(userId, y, m, { requestId }),
        transactionRepository.getCategoryBreakdown(userId, {
          startDate: startDate || `${y}-${String(m).padStart(2, '0')}-01`,
          endDate: endDate || `${y}-${String(m).padStart(2, '0')}-31`,
          requestId,
        }),
        transactionRepository.getMonthlyTrend(userId, 6, { requestId }),
        transactionRepository.getSavingsRate(userId, y, m, { requestId }),
        transactionRepository.getTopSpendingDays(userId, {
          startDate: `${y}-${String(m).padStart(2, '0')}-01`,
          endDate: `${y}-${String(m).padStart(2, '0')}-31`,
          requestId,
        }),
      ]);

      return { summary, breakdown, trend, savingsRate, topDays, year: y, month: m };
    }, 1800);
  }
}

class InvestmentService {
  async create(userId, dto, { requestId, dek, ipAddress } = {}) {
    const investment = await investmentRepository.create(
      encryptEntity('investments', { ...dto, user_id: userId, current_value: dto.current_value || dto.invested_amount }, dek, process.env.BLIND_INDEX_SECRET),
      { requestId }
    );
    await cache.delPattern(`insight:${userId}:investment*`);
    logger.info('Investment created', { userId, id: investment.id, type: dto.type, requestId, ipAddress });
    return decryptEntity('investments', investment, dek);
  }

  async list(userId, filters, { requestId, dek } = {}) {
    return mapDecrypted('investments', await investmentRepository.findByUser(userId, { ...filters, requestId }), dek);
  }

  async getById(id, userId, { requestId, dek } = {}) {
    const inv = await investmentRepository.findById(id, { requestId });
    if (!inv) throw new AppError('Investment not found', 404, 'INV_NOT_FOUND');
    if (inv.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    return decryptEntity('investments', inv, dek);
  }

  async update(id, userId, dto, { requestId, dek } = {}) {
    await this.getById(id, userId, { requestId, dek });
    delete dto.user_id;
    return decryptEntity('investments', await investmentRepository.update(id, encryptEntity('investments', dto, dek, process.env.BLIND_INDEX_SECRET), { requestId }), dek);
  }

  async delete(id, userId, { requestId, dek } = {}) {
    await this.getById(id, userId, { requestId, dek });
    await investmentRepository.delete(id, { requestId });
    return { message: 'Investment deleted' };
  }

  async getPortfolio(userId, { requestId, dek } = {}) {
    const cacheKey = `portfolio:${userId}`;
    return cache.getOrSet(cacheKey, async () => {
      const [summary, total, sips] = await Promise.all([
        investmentRepository.getPortfolioSummary(userId, { requestId }),
        investmentRepository.getTotalPortfolioValue(userId, { requestId }),
        investmentRepository.getSIPList(userId, { requestId }),
      ]);
      return { summary, total, sips: mapDecrypted('investments', sips, dek) };
    }, 900);
  }
}

class LoanService {
  async create(userId, dto, { requestId, dek, ipAddress } = {}) {
    const loan = await loanRepository.create(
      encryptEntity('loans', { ...dto, user_id: userId, outstanding: dto.outstanding || dto.principal }, dek, process.env.BLIND_INDEX_SECRET),
      { requestId }
    );
    logger.info('Loan created', { userId, id: loan.id, direction: dto.direction, requestId, ipAddress });
    return decryptEntity('loans', loan, dek);
  }

  async list(userId, filters, { requestId, dek } = {}) {
    return mapDecrypted('loans', await loanRepository.findByUser(userId, { ...filters, requestId }), dek);
  }

  async getById(id, userId, { requestId, dek } = {}) {
    const loan = await loanRepository.findById(id, { requestId });
    if (!loan) throw new AppError('Loan not found', 404, 'LOAN_NOT_FOUND');
    if (loan.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    return decryptEntity('loans', loan, dek);
  }

  async update(id, userId, dto, { requestId, dek } = {}) {
    await this.getById(id, userId, { requestId, dek });
    delete dto.user_id;
    return decryptEntity('loans', await loanRepository.update(id, encryptEntity('loans', dto, dek, process.env.BLIND_INDEX_SECRET), { requestId }), dek);
  }

  async recordPayment(loanId, userId, paymentDto, { requestId, dek } = {}) {
    const loan = await this.getById(loanId, userId, { requestId, dek });
    if (!['active', 'partially_paid'].includes(loan.status)) throw new AppError('Loan is already closed', 400, 'LOAN_CLOSED');
    if (paymentDto.amount > loan.outstanding) throw new AppError('Payment exceeds outstanding balance', 400, 'EXCESS_PAYMENT');

    return loanRepository.recordPayment(loanId, { ...paymentDto, user_id: userId }, { requestId });
  }

  async getDashboard(userId, { requestId, dek } = {}) {
    const [summary, overdue, dueSoon] = await Promise.all([
      loanRepository.getLoanSummary(userId, { requestId }),
      loanRepository.getOverdueLoans(userId, { requestId }),
      loanRepository.getDueInDays(userId, 30, { requestId }),
    ]);

    const totalBorrowed = summary.find((s) => s.direction === 'borrowed')?.total_outstanding || 0;
    const totalLent = summary.find((s) => s.direction === 'lent')?.total_outstanding || 0;
    return {
      summary,
      overdue: mapDecrypted('loans', overdue, dek),
      dueSoon: mapDecrypted('loans', dueSoon, dek),
      netDebt: totalBorrowed - totalLent,
      totalBorrowed,
      totalLent,
    };
  }
}

class BudgetService {
  async create(userId, dto, { requestId, dek } = {}) {
    const budget = await budgetRepository.create(encryptEntity('budgets', { ...dto, user_id: userId }, dek, process.env.BLIND_INDEX_SECRET), { requestId });
    await cache.del(`budgets:${userId}`);
    return decryptEntity('budgets', budget, dek);
  }

  async list(userId, { requestId, dek } = {}) {
    const cacheKey = `budgets:${userId}`;
    return cache.getOrSet(cacheKey, async () => mapDecrypted('budgets', await budgetRepository.getBudgetUtilization(userId, { requestId }), dek), 300);
  }

  async update(id, userId, dto, { requestId, dek } = {}) {
    const budget = await budgetRepository.findById(id, { requestId });
    if (!budget) throw new AppError('Budget not found', 404, 'BUDGET_NOT_FOUND');
    if (budget.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    delete dto.user_id;
    const updated = await budgetRepository.update(id, encryptEntity('budgets', dto, dek, process.env.BLIND_INDEX_SECRET), { requestId });
    await cache.del(`budgets:${userId}`);
    return decryptEntity('budgets', updated, dek);
  }

  async delete(id, userId, { requestId } = {}) {
    const budget = await budgetRepository.findById(id, { requestId });
    if (!budget) throw new AppError('Budget not found', 404, 'BUDGET_NOT_FOUND');
    if (budget.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    await budgetRepository.delete(id, { requestId });
    await cache.del(`budgets:${userId}`);
    return { message: 'Budget deleted' };
  }
}

module.exports = {
  transactionService: new TransactionService(),
  investmentService: new InvestmentService(),
  loanService: new LoanService(),
  budgetService: new BudgetService(),
};
