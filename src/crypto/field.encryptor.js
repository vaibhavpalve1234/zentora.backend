'use strict';

const { encryptValue, decryptValue } = require('./encryption.engine');
const { createBlindIndex } = require('./blind.index');

const FIELD_CONFIG = {
  users: {
    encrypted: ['full_name'],
  },
  transactions: {
    encrypted: ['description', 'tags', 'payment_method', 'recurrence_rule'],
  },
  investments: {
    encrypted: ['name', 'symbol', 'notes', 'meta'],
  },
  loans: {
    encrypted: ['party_name', 'party_contact', 'purpose', 'notes'],
    blindIndexes: {
      party_name_bi: 'party_name',
    },
  },
  budgets: {
    encrypted: ['name'],
  },
  ai_insights: {
    encrypted: ['title', 'content'],
  },
};

function parseMaybeJSON(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function encryptEntity(entityName, payload, dek, blindIndexSecret) {
  if (!payload || !dek) return payload;
  const config = FIELD_CONFIG[entityName];
  if (!config) return { ...payload };

  const next = { ...payload };

  for (const field of config.encrypted || []) {
    if (Object.prototype.hasOwnProperty.call(next, field) && next[field] !== undefined) {
      next[field] = encryptValue(next[field], dek);
    }
  }

  for (const [indexField, sourceField] of Object.entries(config.blindIndexes || {})) {
    if (Object.prototype.hasOwnProperty.call(next, sourceField)) {
      next[indexField] = createBlindIndex(next[sourceField], blindIndexSecret);
    }
  }

  return next;
}

function decryptEntity(entityName, row, dek) {
  if (!row || !dek) return row;
  const config = FIELD_CONFIG[entityName];
  if (!config) return { ...row };

  const next = { ...row };

  for (const field of config.encrypted || []) {
    if (Object.prototype.hasOwnProperty.call(next, field) && next[field] !== null && next[field] !== undefined) {
      next[field] = parseMaybeJSON(decryptValue(next[field], dek));
    }
  }

  return next;
}

module.exports = {
  FIELD_CONFIG,
  encryptEntity,
  decryptEntity,
};
