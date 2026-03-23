'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const VERSION = 'v1';

function toBuffer(key) {
  if (Buffer.isBuffer(key)) return key;
  if (typeof key === 'string') return Buffer.from(key, 'hex');
  throw new TypeError('Encryption key must be a Buffer or hex string');
}

function encryptValue(value, key) {
  if (value === null || value === undefined) return value;

  const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, toBuffer(key), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    'enc',
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

function decryptValue(value, key) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value;

  const [, version, ivB64, tagB64, encryptedB64] = value.split(':');
  if (version !== VERSION) throw new Error(`Unsupported encryption version: ${version}`);

  const decipher = crypto.createDecipheriv(ALGO, toBuffer(key), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

module.exports = {
  ALGO,
  VERSION,
  encryptValue,
  decryptValue,
};
