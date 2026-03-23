'use strict';

/**
 * EmbeddingService
 *
 * Converts financial events (transactions, insights) into vector embeddings
 * that are stored in ChromaDB for future RAG retrieval.
 *
 * Pattern: Facade — provides simple embed/store/retrieve API
 *          hiding the complexity of provider calls + vector store operations.
 */

const { AIProviderFactory } = require('../providers/gemini.provider');
const vectorStore            = require('./vector.store');
const { query }              = require('../../config/database');
const { v4: uuidv4 }         = require('uuid');
const logger                 = require('../../config/logger');

class EmbeddingService {
  constructor() {
    this.provider = AIProviderFactory.getProvider('gemini');
  }

  // ─── Text representation factories ────────────────────────────────────────

  _transactionToText(txn) {
    return `
Transaction: ${txn.type} of ${txn.amount} ${txn.currency || ''}
Date: ${txn.transaction_date}
Category: ${txn.category || 'Unknown'}
Description: ${txn.description || 'None'}
Payment: ${txn.payment_method || 'Unknown'}
`.trim();
  }

  _investmentToText(inv) {
    const pnl = inv.current_value - inv.invested_amount;
    const pnlPct = inv.invested_amount > 0
      ? ((pnl / inv.invested_amount) * 100).toFixed(2)
      : 0;
    return `
Investment: ${inv.name} (${inv.type})
Invested: ${inv.invested_amount}, Current Value: ${inv.current_value}
P&L: ${pnl} (${pnlPct}%)
Status: ${inv.status}
`.trim();
  }

  _loanToText(loan) {
    return `
Loan (${loan.direction}): from/to ${loan.party_name}
Principal: ${loan.principal}, Outstanding: ${loan.outstanding}
Interest: ${loan.interest_rate}% (${loan.interest_type})
Due: ${loan.due_date || 'No due date'}
Status: ${loan.status}
`.trim();
  }

  _insightToText(insight) {
    return `
Financial Insight (${insight.insight_type}): ${insight.title}
${insight.content.slice(0, 500)}
Generated: ${insight.generated_at}
`.trim();
  }

  // ─── Embed and store a batch of transactions ───────────────────────────────
  async embedTransactions(transactions, userId, { requestId } = {}) {
    if (!transactions?.length) return;

    const texts = transactions.map(t => this._transactionToText(t));
    let embeddings;
    try {
      embeddings = await this.provider.embed(texts);
    } catch (err) {
      logger.warn('Embedding failed, skipping vector store update', { error: err.message });
      return;
    }

    const items = transactions.map((t, i) => ({
      id:        `txn_${t.id}`,
      embedding: embeddings[i],
      document:  texts[i],
      metadata: {
        userId,
        sourceType: 'transaction',
        sourceId:   t.id,
        txnType:    t.type,
        category:   t.category || '',
        date:       t.transaction_date,
        amount:     String(t.amount),
      },
    }));

    await vectorStore.upsert(items);

    // Track in MySQL
    await this._persistMetadata(
      userId,
      items.map((item, i) => ({
        chromaDocId:    item.id,
        sourceType:     'transaction',
        sourceId:       transactions[i].id,
        contentPreview: texts[i].slice(0, 200),
      })),
      { requestId }
    );

    logger.info('Transactions embedded', { count: items.length, userId, requestId });
  }

  // ─── Embed and store a single insight ─────────────────────────────────────
  async embedInsight(insight, userId, { requestId } = {}) {
    const text = this._insightToText(insight);
    let embeddings;
    try {
      embeddings = await this.provider.embed([text]);
    } catch { return; }

    const item = {
      id:        `insight_${insight.id}`,
      embedding: embeddings[0],
      document:  text,
      metadata: {
        userId,
        sourceType:  'insight',
        sourceId:    insight.id,
        insightType: insight.insight_type,
        date:        insight.generated_at?.slice(0, 10) || '',
      },
    };

    await vectorStore.upsert([item]);
    await this._persistMetadata(userId, [{ chromaDocId: item.id, sourceType: 'insight', sourceId: insight.id, contentPreview: text.slice(0, 200) }], { requestId });
  }

  // ─── Retrieve relevant context for a query ────────────────────────────────

  /**
   * Given a natural language question, find the most relevant stored
   * financial documents in ChromaDB.
   *
   * Used by InsightService before calling Gemini to enrich the context.
   */
  async retrieveRelevantContext(queryText, userId, { topK = 5, sourceType = null, requestId } = {}) {
    let queryEmbedding;
    try {
      [queryEmbedding] = await this.provider.embed([queryText]);
    } catch {
      return [];
    }

    return vectorStore.query(queryEmbedding, userId, topK, sourceType);
  }

  // ─── MySQL metadata persistence ───────────────────────────────────────────
  async _persistMetadata(userId, items, { requestId } = {}) {
    if (!items.length) return;
    const rows = items.map(item =>
      `(UUID(), '${userId}', '${item.chromaDocId}', '${item.sourceType}', ${item.sourceId ? `'${item.sourceId}'` : 'NULL'}, ${item.contentPreview ? `'${item.contentPreview.replace(/'/g, "''")}'` : 'NULL'}, NOW())`
    );
    try {
      await query(
        `INSERT INTO vector_metadata (id, user_id, chroma_doc_id, source_type, source_id, content_preview, embedded_at)
         VALUES ${rows.join(', ')}
         ON DUPLICATE KEY UPDATE embedded_at = NOW()`,
        [],
        { requestId }
      );
    } catch (err) {
      logger.warn('Vector metadata persist failed', { error: err.message });
    }
  }
}

module.exports = new EmbeddingService();