'use strict';

/**
 * AI Prompt System
 *
 * Three separate responsibilities (SRP):
 *   1. SystemPrompts   — static, version-controlled AI persona & rules
 *   2. ContextBuilder  — builds dynamic financial context from user data
 *   3. PromptFactory   — assembles final prompts for each insight type
 *
 * Design Pattern: Builder + Factory Method
 *
 * Why separate system vs user prompt?
 *   - System prompts are static and cacheable; they set AI behaviour.
 *   - User/context prompts are dynamic and contain financial data.
 *   - Separation = cleaner prompt engineering + easier A/B testing.
 */

const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════
const SystemPrompts = {
  /**
   * Core financial advisor persona.
   * Written to minimise hallucination and keep responses data-grounded.
   */
  FINANCIAL_ADVISOR: `
You are MoneyMind, an expert AI financial advisor integrated into the Money Control Pro app.

ROLE & CAPABILITIES:
- Analyse personal finance data (income, expenses, investments, loans)
- Provide actionable, personalised financial insights
- Flag anomalies, overspending, and savings opportunities
- Give investment allocation suggestions based on risk profile

STRICT RULES — ALWAYS FOLLOW:
1. ONLY use the financial data provided in the context. Never invent numbers.
2. All monetary values are in the user's currency (stated in context).
3. Be concise — max 3 bullet points per recommendation unless asked for detail.
4. Flag if data is insufficient for a conclusion. Do not guess.
5. Never give tax, legal, or medical advice — suggest consulting professionals.
6. When making investment suggestions, always state: "This is not SEBI-registered advice."
7. Use positive, encouraging language. Focus on improvement, not criticism.

OUTPUT FORMAT:
- Return ONLY valid JSON matching the schema requested in the user prompt.
- No preamble, no markdown outside JSON strings, no apologies.
`.trim(),

  ANOMALY_DETECTOR: `
You are a financial anomaly detection engine.
Analyse transaction patterns and identify:
- Unusual spikes in spending
- Duplicate or suspicious charges
- Categories exceeding historical averages by more than 50%

Return ONLY valid JSON. Be precise, data-driven, and concise.
`.trim(),

  SAVINGS_COACH: `
You are a savings optimisation coach.
Your goal: help users increase their savings rate through practical, achievable steps.
Focus on: reducing discretionary spend, automating savings, and improving investment habits.
Always provide at least one actionable step that can be done today.
Return ONLY valid JSON.
`.trim(),
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════
class ContextBuilder {
  constructor() {
    this._sections = [];
  }

  /**
   * Add user profile section
   */
  withUserProfile(user) {
    this._sections.push(`
## USER PROFILE
- Name:      ${user.full_name}
- Currency:  ${user.currency}
- Timezone:  ${user.timezone}
- Member since: ${user.created_at?.slice(0, 10)}
`.trim());
    return this;
  }

  /**
   * Add monthly summary section
   */
  withMonthlySummary(summary, year, month) {
    const lines = summary.map(s =>
      `  ${s.type.toUpperCase()}: ${s.total_amount} (${s.txn_count} transactions, avg ${s.avg_amount?.toFixed(2)})`
    );
    this._sections.push(`
## MONTHLY SUMMARY — ${year}-${String(month).padStart(2, '0')}
${lines.join('\n')}
`.trim());
    return this;
  }

  /**
   * Add savings metrics
   */
  withSavingsMetrics({ income, expense, savings, savingsRate }) {
    this._sections.push(`
## SAVINGS METRICS
- Total Income:   ${income}
- Total Expense:  ${expense}
- Net Savings:    ${savings}
- Savings Rate:   ${savingsRate}%
- Status: ${savingsRate >= 20 ? '✅ Healthy (≥20%)' : savingsRate >= 10 ? '⚠️ Moderate (10-20%)' : '🔴 Low (<10%)'}
`.trim());
    return this;
  }

  /**
   * Add top expense categories
   */
  withCategoryBreakdown(categories) {
    if (!categories?.length) return this;
    const lines = categories.slice(0, 8).map(c =>
      `  - ${c.category}: ${c.total_amount} (${c.percentage}%)`
    );
    this._sections.push(`
## TOP EXPENSE CATEGORIES
${lines.join('\n')}
`.trim());
    return this;
  }

  /**
   * Add recent transactions (last 10 for context)
   */
  withRecentTransactions(transactions) {
    if (!transactions?.length) return this;
    const lines = transactions.slice(0, 10).map(t =>
      `  [${t.transaction_date}] ${t.type.toUpperCase()} ${t.amount} — ${t.category} (${t.description || 'no description'})`
    );
    this._sections.push(`
## RECENT TRANSACTIONS (Last 10)
${lines.join('\n')}
`.trim());
    return this;
  }

  /**
   * Add investment portfolio
   */
  withPortfolio(portfolioSummary, totalValue) {
    if (!portfolioSummary?.length) return this;
    const lines = portfolioSummary.map(p =>
      `  ${p.type.toUpperCase()}: Invested=${p.total_invested}, Current=${p.total_current_value}, P&L=${p.total_pnl} (${p.pnl_percentage}%)`
    );
    this._sections.push(`
## INVESTMENT PORTFOLIO
- Total Invested:      ${totalValue?.total_invested     || 0}
- Total Current Value: ${totalValue?.total_current_value || 0}
By Type:
${lines.join('\n')}
`.trim());
    return this;
  }

  /**
   * Add loans
   */
  withLoans(loanSummary, overdueLoans = []) {
    if (!loanSummary?.length && !overdueLoans?.length) return this;

    const summaryLines = loanSummary.map(l =>
      `  ${l.direction.toUpperCase()}: Count=${l.count}, Principal=${l.total_principal}, Outstanding=${l.total_outstanding}`
    );
    const overdueLines = overdueLoans.map(l =>
      `  ⚠️ OVERDUE: ${l.party_name} — Outstanding=${l.outstanding}, Due=${l.due_date}`
    );

    this._sections.push(`
## LOANS
${summaryLines.join('\n')}
${overdueLines.length ? 'OVERDUE LOANS:\n' + overdueLines.join('\n') : ''}
`.trim());
    return this;
  }

  /**
   * Add budget utilization
   */
  withBudgets(budgets) {
    if (!budgets?.length) return this;
    const lines = budgets.map(b =>
      `  ${b.name}: ${b.spent_amount}/${b.budget_amount} (${b.utilization_pct}%)${b.utilization_pct >= b.alert_at ? ' ⚠️ ALERT' : ''}`
    );
    this._sections.push(`
## BUDGET UTILIZATION
${lines.join('\n')}
`.trim());
    return this;
  }

  /**
   * Add retrieved RAG context (from ChromaDB)
   */
  withRAGContext(ragChunks) {
    if (!ragChunks?.length) return this;
    const lines = ragChunks.map((chunk, i) =>
      `  [${i + 1}] ${chunk.document} (relevance: ${(1 - chunk.distance).toFixed(2)})`
    );
    this._sections.push(`
## HISTORICAL FINANCIAL PATTERNS (retrieved context)
${lines.join('\n')}
`.trim());
    return this;
  }

  /**
   * Build the final context string and compute its hash
   * (hash is used for deduplication in ai_insights table)
   */
  build() {
    const context = this._sections.join('\n\n');
    const hash = crypto.createHash('sha256').update(context).digest('hex');
    return { context, hash };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PROMPT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PromptFactory — Factory Method Pattern
 *
 * Each factory method returns { systemPrompt, userPrompt }
 * This is the ONLY place where prompts are assembled.
 * AI services call PromptFactory, not hardcode strings.
 */
class PromptFactory {

  /**
   * Monthly financial summary insight
   */
  static monthlySummary(context, year, month) {
    return {
      systemPrompt: SystemPrompts.FINANCIAL_ADVISOR,
      userPrompt: `
FINANCIAL CONTEXT:
${context}

TASK: Generate a comprehensive monthly financial summary for ${year}-${String(month).padStart(2, '0')}.

Return EXACTLY this JSON structure:
{
  "title": "Monthly Summary — <Month> <Year>",
  "overall_health": "excellent|good|fair|poor",
  "health_score": <0-100 integer>,
  "key_metrics": {
    "income": <number>,
    "expenses": <number>,
    "savings": <number>,
    "savings_rate": <number>
  },
  "highlights": [
    "<positive observation 1>",
    "<positive observation 2>"
  ],
  "concerns": [
    "<concern or risk 1>"
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "<specific actionable step>",
      "expected_impact": "<what will improve and by roughly how much>"
    }
  ],
  "investment_insight": "<one sentence on portfolio performance>",
  "next_month_goal": "<one specific, measurable goal for next month>"
}
`.trim(),
    };
  }

  /**
   * Spending anomaly detection
   */
  static spendingAnomaly(context) {
    return {
      systemPrompt: SystemPrompts.ANOMALY_DETECTOR,
      userPrompt: `
FINANCIAL CONTEXT:
${context}

TASK: Detect spending anomalies in the transaction data above.

Return EXACTLY this JSON structure:
{
  "anomalies_found": <boolean>,
  "anomalies": [
    {
      "type": "spike|duplicate|unusual_category|large_transaction",
      "description": "<what was detected>",
      "amount": <number>,
      "date": "<YYYY-MM-DD>",
      "category": "<category name>",
      "severity": "high|medium|low",
      "recommendation": "<what to do about it>"
    }
  ],
  "patterns_noted": [
    "<recurring pattern description>"
  ]
}
`.trim(),
    };
  }

  /**
   * Investment rebalancing suggestion
   */
  static investmentAdvice(context) {
    return {
      systemPrompt: SystemPrompts.FINANCIAL_ADVISOR,
      userPrompt: `
FINANCIAL CONTEXT:
${context}

TASK: Analyse the investment portfolio and provide actionable advice.
IMPORTANT: Include "This is not SEBI-registered advice." in the disclaimer field.

Return EXACTLY this JSON structure:
{
  "title": "Investment Portfolio Analysis",
  "portfolio_score": <0-100>,
  "diversification": "well_diversified|moderately_diversified|concentrated",
  "top_performer": "<investment name and return>",
  "underperformer": "<investment name or null>",
  "allocation_advice": [
    {
      "asset_class": "<e.g., equity, debt, gold>",
      "current_pct": <number>,
      "suggested_pct": <number>,
      "reasoning": "<why>"
    }
  ],
  "sip_recommendation": "<advice on SIP amounts>",
  "action_items": [
    "<specific step 1>",
    "<specific step 2>"
  ],
  "disclaimer": "This is not SEBI-registered advice. Consult a qualified financial advisor."
}
`.trim(),
    };
  }

  /**
   * Savings optimisation
   */
  static savingsTip(context) {
    return {
      systemPrompt: SystemPrompts.SAVINGS_COACH,
      userPrompt: `
FINANCIAL CONTEXT:
${context}

TASK: Identify the top 3 ways this user can increase their savings rate.
Focus on the highest-spend categories and any budget overruns.

Return EXACTLY this JSON structure:
{
  "title": "Savings Optimisation Tips",
  "current_savings_rate": <number>,
  "target_savings_rate": <number>,
  "potential_monthly_savings": <number>,
  "tips": [
    {
      "rank": 1,
      "category": "<expense category to target>",
      "current_spend": <number>,
      "suggested_reduction": <number>,
      "how_to": "<specific, actionable advice>",
      "difficulty": "easy|medium|hard"
    }
  ],
  "quick_win": "<one thing they can do today to save money>"
}
`.trim(),
    };
  }

  /**
   * Custom / free-form question
   */
  static customQuery(context, userQuestion) {
    return {
      systemPrompt: SystemPrompts.FINANCIAL_ADVISOR,
      userPrompt: `
FINANCIAL CONTEXT:
${context}

USER QUESTION: ${userQuestion}

Answer the question based ONLY on the data in the context above.
Return EXACTLY this JSON structure:
{
  "title": "<short title for this insight>",
  "answer": "<comprehensive answer to the user question>",
  "data_points_used": ["<data point 1>", "<data point 2>"],
  "confidence": "high|medium|low",
  "caveats": "<any important limitations or assumptions>",
  "follow_up_suggestions": ["<related question 1>", "<related question 2>"]
}
`.trim(),
    };
  }

  /**
   * Loan management advice
   */
  static loanAdvice(context) {
    return {
      systemPrompt: SystemPrompts.FINANCIAL_ADVISOR,
      userPrompt: `
FINANCIAL CONTEXT:
${context}

TASK: Analyse the loan situation and provide debt management advice.

Return EXACTLY this JSON structure:
{
  "title": "Loan & Debt Analysis",
  "debt_ratio": <debt-to-income ratio as number>,
  "debt_health": "healthy|manageable|concerning|critical",
  "overdue_action": "<what to do about overdue loans if any, or null>",
  "payoff_strategy": "avalanche|snowball|consolidation|refinance",
  "strategy_explanation": "<why this strategy fits their situation>",
  "monthly_payment_suggestion": <number>,
  "estimated_debt_free_months": <number or null>,
  "action_items": ["<step 1>", "<step 2>"]
}
`.trim(),
    };
  }
}

module.exports = { SystemPrompts, ContextBuilder, PromptFactory };