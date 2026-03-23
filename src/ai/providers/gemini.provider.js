'use strict';

/**
 * AI Provider Layer — Strategy Pattern
 *
 * ILLMProvider (interface contract) ─── GeminiProvider
 *                                   └── (future: OllamaProvider, OpenAIProvider)
 *
 * SOLID:
 *  O — Adding a new provider means creating a new class, not editing existing ones.
 *  D — Services depend on ILLMProvider, not GeminiProvider directly.
 *
 * Design Pattern: Strategy — swap providers at runtime or config.
 */

const { GoogleGenAI } = require('@google/genai');
const logger = require('../../config/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Interface contract (documentation-as-code)
// ─────────────────────────────────────────────────────────────────────────────
class ILLMProvider {
  /**
   * @param {string}   systemPrompt
   * @param {string}   userPrompt
   * @param {object}   opts
   * @param {number}   opts.temperature
   * @param {number}   opts.maxTokens
   * @param {string}   opts.requestId
   * @returns {Promise<{text: string, tokensUsed: number, model: string}>}
   */
  async generate(systemPrompt, userPrompt, opts = {}) {
    throw new Error('ILLMProvider.generate() must be implemented');
  }

  /**
   * @param {string|string[]} text
   * @returns {Promise<number[][]>}  - array of embedding vectors
   */
  async embed(text) {
    throw new Error('ILLMProvider.embed() must be implemented');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini Provider
// ─────────────────────────────────────────────────────────────────────────────
class GeminiProvider extends ILLMProvider {
  constructor() {
    super();
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required');
    }

    this.ai    = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.model = process.env.GEMINI_MODEL        || 'gemini-2.5-flash';
    this.embeddingModel = 'text-embedding-004';   // 768-dim, free tier friendly

    this.defaultTemperature = parseFloat(process.env.GEMINI_TEMPERATURE || '0.3');
    this.defaultMaxTokens   = parseInt(process.env.GEMINI_MAX_TOKENS    || '2048', 10);

    logger.info('GeminiProvider initialised', { model: this.model });
  }

  /**
   * Generate structured response.
   * We wrap the user prompt with the system context because Gemini API
   * handles system instructions via `systemInstruction` field in the new SDK.
   */
  async generate(systemPrompt, userPrompt, {
    temperature = this.defaultTemperature,
    maxTokens   = this.defaultMaxTokens,
    requestId,
    jsonMode    = false,
  } = {}) {
    const start = Date.now();

    const config = {
      temperature,
      maxOutputTokens: maxTokens,
      ...(jsonMode && { responseMimeType: 'application/json' }),
    };

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: userPrompt,
        config: {
          ...config,
          systemInstruction: systemPrompt,
        },
      });

      const text       = response.text;
      const tokensUsed = response.usageMetadata?.totalTokenCount || 0;
      const latencyMs  = Date.now() - start;

      logger.info('Gemini generation complete', {
        requestId,
        model:      this.model,
        tokensUsed,
        latencyMs,
        promptLen:  userPrompt.length,
      });

      return {
        text,
        tokensUsed,
        model: this.model,
        latencyMs,
      };
    } catch (err) {
      logger.error('Gemini generation failed', {
        requestId,
        error:    err.message,
        errorCode: err.status || err.code,
        latencyMs: Date.now() - start,
      });

      // Retry on transient 503
      if (err.status === 503 && !this._retrying) {
        this._retrying = true;
        await new Promise(r => setTimeout(r, 2000));
        this._retrying = false;
        return this.generate(systemPrompt, userPrompt, { temperature, maxTokens, requestId, jsonMode });
      }

      throw new AIProviderError(err.message, err.status || 500, 'GEMINI');
    }
  }

  /**
   * Generate embeddings using Gemini text-embedding-004
   * Gemini embeds up to 2048 tokens per request.
   */
  async embed(texts) {
    const textArray = Array.isArray(texts) ? texts : [texts];
    const start = Date.now();

    try {
      const embeddings = [];

      // Batch in groups of 20 (API limit awareness)
      const BATCH_SIZE = 20;
      for (let i = 0; i < textArray.length; i += BATCH_SIZE) {
        const batch = textArray.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(text =>
          this.ai.models.embedContent({
            model: this.embeddingModel,
            contents: text,
            config: { taskType: 'RETRIEVAL_DOCUMENT' },
          })
        );
        const results = await Promise.all(batchPromises);
        embeddings.push(...results.map(r => r.embeddings[0].values));
      }

      logger.debug('Gemini embeddings generated', {
        count: embeddings.length,
        latencyMs: Date.now() - start,
      });

      return embeddings;
    } catch (err) {
      logger.error('Gemini embedding failed', { error: err.message });
      throw new AIProviderError(err.message, err.status || 500, 'GEMINI_EMBED');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Factory — returns the configured provider
// ─────────────────────────────────────────────────────────────────────────────
class AIProviderFactory {
  static _instances = {};

  /**
   * @param {'gemini'|'openai'|'ollama'} providerName
   * @returns {ILLMProvider}
   */
  static getProvider(providerName = 'gemini') {
    if (AIProviderFactory._instances[providerName]) {
      return AIProviderFactory._instances[providerName];
    }

    let instance;
    switch (providerName.toLowerCase()) {
      case 'gemini':
        instance = new GeminiProvider();
        break;
      // Future providers:
      // case 'openai':  instance = new OpenAIProvider();  break;
      // case 'ollama':  instance = new OllamaProvider();  break;
      default:
        throw new Error(`Unknown AI provider: ${providerName}`);
    }

    AIProviderFactory._instances[providerName] = instance;
    return instance;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────
class AIProviderError extends Error {
  constructor(message, statusCode = 500, provider = 'UNKNOWN') {
    super(message);
    this.name        = 'AIProviderError';
    this.statusCode  = statusCode;
    this.provider    = provider;
  }
}

module.exports = { ILLMProvider, GeminiProvider, AIProviderFactory, AIProviderError };