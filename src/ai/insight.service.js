'use strict';

/**
 * InsightService — Orchestration Layer for AI
 *
 * Workflow for every insight:
 *   1. Load financial data from MySQL (repositories)
 *   2. Retrieve historical context from ChromaDB (RAG)
 *   3. Build structured context (ContextBuilder)
 *   4. Assemble prompt (PromptFactory)
 *   5. Check dedup cache (avoid regenerating identical insight)
 *   6. Call Gemini API (GeminiProvider)
 *   7. Parse + validate JSON response
 *   8. Persist insight to MySQL
 *   9. Store insight embedding in ChromaDB (for future RAG)
 *  10. Return to caller
 *
 * SOLID:
 *   S — InsightService only orchestrates; each dependency does its own job
 *   D — Depends on abstractions (ILLMProvider, repositories), not concretes
 */

const { AIProviderFactory } = require('../providers/gemini.provider');
const { ContextBuilder, PromptFactory } = require('../prompts/prompt.system');
const embeddingService       = require('../vector/embedding.service');
const {
  transactionRepository,
  investmentRepository,
  loanRepository,
  budgetRepository,
  insightRepository,
  userRepository,
} = require('../../repositories');
const cache = require('../../config/redis');
const logger = require('../../config/logger');

const INSIGHT_CACHE_TTL = 1800; // 30 min

class InsightService {
  constructor() {
    this.llm = AIProviderFactory.getProvider('gemini');
  }

  // ─── Shared context assembly ───────────────────────────────────────────────
  async _buildFullContext(userId, { year, month, startDate, endDate, requestId } = {}) {
    const now = new Date();
    const y   = year  || now.getFullYear();
    const m   = month || now.getMonth() + 1;
    const sd  = startDate || `${y}-${String(m).padStart(2, '0')}-01`;
    const ed  = endDate   || `${y}-${String(m).padStart(2, '0')}-31`;

    // Parallel data fetch — all queries run simultaneously
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
      .withUserProfile(user)
      .withMonthlySummary(monthlySummary, y, m)
      .withSavingsMetrics(savingsMetrics)
      .withCategoryBreakdown(categoryBreakdown)
      .withRecentTransactions(recentTxns)
      .withPortfolio(portfolioSummary, totalPortfolio)
      .withLoans(loanSummary, overdueLoans)
      .withBudgets(budgets);

    return { contextBuilder, year: y, month: m };
  }

  // ─── Core generation + parse pipeline ─────────────────────────────────────
  async _generate(userId, insightType, promptBuilder, { requestId, skipCache = false } = {}) {
    // 1. Build context
    const { contextBuilder, year, month } = await this._buildFullContext(userId, { requestId });

    // 2. Retrieve RAG context from ChromaDB
    const ragDocs = await embeddingService.retrieveRelevantContext(
      `${insightType} financial analysis`,
      userId,
      { topK: 5, requestId }
    );
    contextBuilder.withRAGContext(ragDocs);

    const { context, hash } = contextBuilder.build();

    // 3. Dedup check
    if (!skipCache) {
      const cacheKey = `insight:${userId}:${insightType}:${hash}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        logger.info('Insight served from cache', { userId, insightType, requestId });
        return cached;
      }

      const exists = await insightRepository.existsByContextHash(userId, hash, { requestId });
      if (exists) {
        logger.info('Insight already exists for this context', { userId, insightType, requestId });
        const existing = await insightRepository.findOne({ user_id: userId, insight_type: insightType }, { requestId });
        if (existing) return this._parseContent(existing.content);
      }
    }

    // 4. Build prompts
    const { systemPrompt, userPrompt } = promptBuilder(context, year, month);

    // 5. Call LLM
    const llmResult = await this.llm.generate(systemPrompt, userPrompt, {
      temperature: 0.2,    // Low temp for deterministic financial advice
      maxTokens:   2048,
      jsonMode:    true,   // Force JSON response
      requestId,
    });

    // 6. Parse JSON — robust error handling
    const parsed = this._parseJSON(llmResult.text, insightType);

    // 7. Persist to MySQL
    const insightRecord = await insightRepository.create({
      user_id:      userId,
      insight_type: insightType,
      title:        parsed.title || `${insightType} Insight`,
      content:      JSON.stringify(parsed),
      context_hash: hash,
      prompt_tokens: llmResult.tokensUsed,
      model_used:   llmResult.model,
      expires_at:   new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    }, { requestId });

    // 8. Embed insight into ChromaDB (background, don't await to avoid latency)
    embeddingService.embedInsight(insightRecord, userId, { requestId })
      .catch(e => logger.warn('Background insight embed failed', { error: e.message }));

    // 9. Cache result
    const cacheKey = `insight:${userId}:${insightType}:${hash}`;
    await cache.set(cacheKey, parsed, INSIGHT_CACHE_TTL);

    logger.info('Insight generated', {
      userId,
      insightType,
      tokensUsed: llmResult.tokensUsed,
      latencyMs:  llmResult.latencyMs,
      requestId,
    });

    return parsed;
  }

  // ─── JSON parser with fallback ─────────────────────────────────────────────
  _parseJSON(rawText, insightType) {
    try {
      // Gemini sometimes wraps in ```json ... ``` even in JSON mode
      const clean = rawText
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      return JSON.parse(clean);
    } catch (err) {
      logger.error('LLM JSON parse failed', {
        insightType,
        rawLength: rawText.length,
        raw: rawText.slice(0, 300),
        error: err.message,
      });
      // Return a structured error response rather than throwing
      return {
        title: `${insightType} (parse error)`,
        error: 'Could not parse AI response',
        raw:   rawText.slice(0, 500),
      };
    }
  }

  _parseContent(contentString) {
    try {
      return JSON.parse(contentString);
    } catch {
      return { raw: contentString };
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async getMonthlySummary(userId, year, month, { requestId } = {}) {
    return this._generate(
      userId,
      'monthly_summary',
      (ctx, y, m) => PromptFactory.monthlySummary(ctx, y, m),
      { requestId }
    );
  }

  async detectAnomalies(userId, { requestId } = {}) {
    return this._generate(
      userId,
      'anomaly',
      (ctx) => PromptFactory.spendingAnomaly(ctx),
      { requestId, skipCache: true }  // Always fresh for anomaly detection
    );
  }

  async getInvestmentAdvice(userId, { requestId } = {}) {
    return this._generate(
      userId,
      'investment_advice',
      (ctx) => PromptFactory.investmentAdvice(ctx),
      { requestId }
    );
  }

  async getSavingsTips(userId, { requestId } = {}) {
    return this._generate(
      userId,
      'savings_tip',
      (ctx) => PromptFactory.savingsTip(ctx),
      { requestId }
    );
  }

  async getLoanAdvice(userId, { requestId } = {}) {
    return this._generate(
      userId,
      'loan_reminder',
      (ctx) => PromptFactory.loanAdvice(ctx),
      { requestId }
    );
  }

  async askCustom(userId, question, { requestId } = {}) {
    return this._generate(
      userId,
      'custom',
      (ctx) => PromptFactory.customQuery(ctx, question),
      { requestId, skipCache: true }
    );
  }

  async getInsightHistory(userId, { insightType, unreadOnly, limit, requestId } = {}) {
    const rows = await insightRepository.findByUser(userId, { insightType, unreadOnly, limit, requestId });
    return rows.map(r => ({
      ...r,
      content: this._parseContent(r.content),
    }));
  }

  async markRead(insightId, userId, { requestId } = {}) {
    return insightRepository.update(insightId, { is_read: true }, { requestId });
  }
}

module.exports = new InsightService();