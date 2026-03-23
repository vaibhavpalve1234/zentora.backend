'use strict';

/**
 * ChromaDB Vector Store Client
 *
 * Purpose: Enables RAG (Retrieval-Augmented Generation) so the AI can
 * retrieve relevant historical financial patterns before generating insights.
 *
 * Architecture:
 *   User financial events → EmbeddingService → ChromaDB (store)
 *   AI insight request    → EmbeddingService → ChromaDB (query) → top-k docs → LLM context
 *
 * Why ChromaDB for a small project?
 *   - Zero infrastructure for local dev (embedded mode)
 *   - HTTP server mode for production Docker deployment
 *   - Simple Node.js client
 *   - Scales to millions of vectors before needing Pinecone/Qdrant
 *
 * Graceful degradation: if ChromaDB is unavailable, RAG is skipped.
 * The AI still works, just without historical context retrieval.
 */

const { ChromaClient } = require('chromadb');
const logger = require('../../config/logger');

const {
  CHROMA_HOST            = 'localhost',
  CHROMA_PORT            = 8000,
  CHROMA_COLLECTION      = 'money_control_embeddings',
  CHROMA_AUTH_TOKEN      = '',
  EMBEDDING_DIMENSION    = 768,
} = process.env;

class VectorStore {
  constructor() {
    this._client     = null;
    this._collection = null;
    this._ready      = false;
    this._initPromise = null;
  }

  // ─── Lazy initialization ───────────────────────────────────────────────────
  async _ensureReady() {
    if (this._ready) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._init().catch((err) => {
      logger.warn('ChromaDB unavailable — vector store disabled', { error: err.message });
      this._ready = false;
      this._initPromise = null;
    });

    return this._initPromise;
  }

  async _init() {
    const clientConfig = {
      path: `http://${CHROMA_HOST}:${CHROMA_PORT}`,
    };

    if (CHROMA_AUTH_TOKEN) {
      clientConfig.auth = {
        provider: 'token',
        credentials: CHROMA_AUTH_TOKEN,
      };
    }

    this._client = new ChromaClient(clientConfig);

    // Ping to verify connection
    await this._client.heartbeat();

    // Get or create the user-namespaced collection
    this._collection = await this._client.getOrCreateCollection({
      name: CHROMA_COLLECTION,
      metadata: {
        description: 'Money Control Pro financial embeddings',
        'hnsw:space': 'cosine',        // Cosine similarity for financial text
        dimension: String(EMBEDDING_DIMENSION),
      },
    });

    this._ready = true;
    logger.info('ChromaDB connected', {
      collection: CHROMA_COLLECTION,
      host: CHROMA_HOST,
    });
  }

  // ─── Store Documents ───────────────────────────────────────────────────────

  /**
   * Upsert financial documents into the vector store.
   *
   * @param {Array<{
   *   id: string,
   *   embedding: number[],
   *   document: string,
   *   metadata: {userId: string, sourceType: string, sourceId?: string, date?: string}
   * }>} items
   */
  async upsert(items) {
    await this._ensureReady();
    if (!this._ready) return false;

    try {
      await this._collection.upsert({
        ids:        items.map(i => i.id),
        embeddings: items.map(i => i.embedding),
        documents:  items.map(i => i.document),
        metadatas:  items.map(i => i.metadata),
      });

      logger.debug('ChromaDB upsert', { count: items.length });
      return true;
    } catch (err) {
      logger.error('ChromaDB upsert failed', { error: err.message });
      return false;
    }
  }

  // ─── Query (Semantic Search) ───────────────────────────────────────────────

  /**
   * Find top-k most relevant documents for a query embedding.
   * Filters by userId so users only get their own financial context.
   *
   * @param {number[]} queryEmbedding
   * @param {string}   userId
   * @param {number}   topK
   * @param {string}   [sourceType] - optional filter
   * @returns {Promise<Array<{id, document, metadata, distance}>>}
   */
  async query(queryEmbedding, userId, topK = 5, sourceType = null) {
    await this._ensureReady();
    if (!this._ready) return [];

    try {
      const where = { userId };
      if (sourceType) where.sourceType = sourceType;

      const results = await this._collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults:        topK,
        where,
        include:         ['documents', 'metadatas', 'distances'],
      });

      const items = [];
      const ids       = results.ids[0]       || [];
      const documents = results.documents[0] || [];
      const metadatas = results.metadatas[0] || [];
      const distances = results.distances[0] || [];

      for (let i = 0; i < ids.length; i++) {
        items.push({
          id:       ids[i],
          document: documents[i],
          metadata: metadatas[i],
          distance: distances[i],           // 0 = identical, 2 = maximally different (cosine)
        });
      }

      logger.debug('ChromaDB query', { userId, topK, found: items.length });
      return items;
    } catch (err) {
      logger.error('ChromaDB query failed', { error: err.message, userId });
      return [];
    }
  }

  // ─── Delete by user ────────────────────────────────────────────────────────
  async deleteByUser(userId) {
    await this._ensureReady();
    if (!this._ready) return;

    try {
      await this._collection.delete({ where: { userId } });
      logger.info('ChromaDB documents deleted', { userId });
    } catch (err) {
      logger.error('ChromaDB delete failed', { error: err.message });
    }
  }

  // ─── Delete specific document ──────────────────────────────────────────────
  async deleteById(id) {
    await this._ensureReady();
    if (!this._ready) return;

    try {
      await this._collection.delete({ ids: [id] });
    } catch (err) {
      logger.error('ChromaDB deleteById failed', { error: err.message });
    }
  }

  isReady() { return this._ready; }
}

// Singleton export
module.exports = new VectorStore();