'use strict';

const crypto = require('crypto');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function createBlindIndex(value, secret) {
  if (value === null || value === undefined || value === '') return null;

  return crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(normalize(value))
    .digest('hex');
}

module.exports = {
  createBlindIndex,
  normalize,
};
