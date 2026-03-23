'use strict';

const { AIProviderFactory } = require('./providers/gemini.provider');
const { ContextBuilder, PromptFactory } = require('./prompts/prompt.system');
const embeddingService = require('./vector/embedding.service');
const {
  transactionRepository,
  investmentRepository,
  loanRepository,
  budgetRepository,
  insightRepository,
  userRepository,
} = require('../repositories');
const cache = require('../config/redis');
const logger = require('../config/logger');
const { decryptEntity, encryptEntity } = require('../crypto');

const INSIGHT_CACHE_TTL = 1800;

class InsightService {
  constructor() {
    this.llm = AIProviderFactory.getProvider('gemini');
  }

  async _buildFullContext(userId, { year, month, startDate, endDate, requestId, dek } = {}) {
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month || now.getMonth() + 1;
    const sd = startDate || `${y}-${String(m).padStart(2, '0')}-01`;
    const ed = endDate || `${y}-${String(m).padStart(2, '0')}-31`;

    const [
      user,
      monthlySummary,
      savingsMetrics,
      categoryBreakdown,
      recentTxns,
      portfolioSummary,
      totalPortfolio,
      loanSummary,
      overdueLoans,
      budgets,
    ] = await Promise.all([
      userRepository.findActiveById(userId, { requestId }),
      transactionRepository.getMonthlySummary(userId, y, m, { requestId }),
      transactionRepository.getSavingsRate(userId, y, m, { requestId }),
      transactionRepository.getCategoryBreakdown(userId, { startDate: sd, endDate: ed, requestId }),
      transactionRepository.getRecentForAI(userId, 15, { requestId }),
      investmentRepository.getPortfolioSummary(userId, { requestId }),
      investmentRepository.getTotalPortfolioValue(userId, { requestId }),
      loanRepository.getLoanSummary(userId, { requestId }),
      loanRepository.getOverdueLoans(userId, { requestId }),
      budgetRepository.getBudgetUtilization(userId, { requestId }),
    ]);

    if (!user) throw new Error(`User ${userId} not found`);

    const contextBuilder = new ContextBuilder()
      .withUserProfile(decryptEntity('users', user, dek))
      .withMonthlySummary(monthlySummary, y, m)
      .withSavingsMetrics(savingsMetrics)
      .withCategoryBreakdown(categoryBreakdown)
      .withRecentTransactions(recentTxns.map((row) => decryptEntity('transactions', row, dek)))
      .withPortfolio(portfolioSummary, totalPortfolio)
      .withLoans(loanSummary, overdueLoans.map((row) => decryptEntity('loans', row, dek)))
      .withBudgets(budgets.map((row) => decryptEntity('budgets', row, dek)));

    return { contextBuilder, year: y, month: m };
  }

  async _generate(userId, insightType, promptBuilder, { requestId, dek, skipCache = false } = {}) {
    const { contextBuilder, year, month } = await this._buildFullContext(userId, { requestId, dek });

    const ragDocs = await embeddingService.retrieveRelevantContext(
      `${insightType} financial analysis`,
      userId,
      { topK: 5, requestId }
    );
    contextBuilder.withRAGContext(ragDocs);

    const { context, hash } = contextBuilder.build();

    if (!skipCache) {
      const cacheKey = `insight:${userId}:${insightType}:${hash}`;
      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const exists = await insightRepository.existsByContextHash(userId, hash, { requestId });
      if (exists) {
        const existing = await insightRepository.findOne({ user_id: userId, insight_type: insightType }, { requestId });
        if (existing) return this._parseContent(decryptEntity('ai_insights', existing, dek).content);
      }
    }

    const { systemPrompt, userPrompt } = promptBuilder(context, year, month);
    const llmResult = await this.llm.generate(systemPrompt, userPrompt, {
      temperature: 0.2,
      maxTokens: 2048,
      jsonMode: true,
      requestId,
    });

    const parsed = this._parseJSON(llmResult.text, insightType);

    const insightRecord = await insightRepository.create(encryptEntity('ai_insights', {
      user_id: userId,
      insight_type: insightType,
      title: parsed.title || `${insightType} Insight`,
      content: JSON.stringify(parsed),
      context_hash: hash,
      prompt_tokens: llmResult.tokensUsed,
      model_used: llmResult.model,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }, dek, process.env.BLIND_INDEX_SECRET), { requestId });

    embeddingService.embedInsight(decryptEntity('ai_insights', insightRecord, dek), userId, { requestId })
      .catch((e) => logger.warn('Background insight embed failed', { error: e.message }));

    await cache.set(`insight:${userId}:${insightType}:${hash}`, parsed, INSIGHT_CACHE_TTL);
    return parsed;
  }

  _parseJSON(rawText, insightType) {
    try {
      return JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim());
    } catch (err) {
      logger.error('LLM JSON parse failed', {
        insightType,
        rawLength: rawText.length,
        raw: rawText.slice(0, 300),
        error: err.message,
      });
      return { title: `${insightType} (parse error)`, error: 'Could not parse AI response', raw: rawText.slice(0, 500) };
    }
  }

  _parseContent(contentString) {
    try {
      return JSON.parse(contentString);
    } catch {
      return { raw: contentString };
    }
  }

  async getMonthlySummary(userId, year, month, { requestId, dek } = {}) {
    return this._generate(userId, 'monthly_summary', (ctx, y, m) => PromptFactory.monthlySummary(ctx, y, m), { requestId, dek });
  }

  async detectAnomalies(userId, { requestId, dek } = {}) {
    return this._generate(userId, 'anomaly', (ctx) => PromptFactory.spendingAnomaly(ctx), { requestId, dek, skipCache: true });
  }

  async getInvestmentAdvice(userId, { requestId, dek } = {}) {
    return this._generate(userId, 'investment_advice', (ctx) => PromptFactory.investmentAdvice(ctx), { requestId, dek });
  }

  async getSavingsTips(userId, { requestId, dek } = {}) {
    return this._generate(userId, 'savings_tip', (ctx) => PromptFactory.savingsTip(ctx), { requestId, dek });
  }

  async getLoanAdvice(userId, { requestId, dek } = {}) {
    return this._generate(userId, 'loan_reminder', (ctx) => PromptFactory.loanAdvice(ctx), { requestId, dek });
  }

  async askCustom(userId, question, { requestId, dek } = {}) {
    return this._generate(userId, 'custom', (ctx) => PromptFactory.customQuery(ctx, question), { requestId, dek, skipCache: true });
  }

  async getInsightHistory(userId, { insightType, unreadOnly, limit, requestId, dek } = {}) {
    const rows = await insightRepository.findByUser(userId, { insightType, unreadOnly, limit, requestId });
    return rows.map((row) => {
      const decrypted = decryptEntity('ai_insights', row, dek);
      return {
        ...decrypted,
        content: this._parseContent(decrypted.content),
      };
    });
  }

  async markRead(insightId, userId, { requestId } = {}) {
    return insightRepository.update(insightId, { is_read: true }, { requestId });
  }
}

module.exports = new InsightService();
