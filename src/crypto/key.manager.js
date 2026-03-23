'use strict';

const crypto = require('crypto');
const { query } = require('../config/database');

const PBKDF2_ITERATIONS = Number(process.env.ENCRYPTION_PBKDF2_ITERATIONS || 310000);
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

function requireHex(name) {
  const value = process.env[name];
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} must be a 64-character hex string`);
  }
  return Buffer.from(value, 'hex');
}

const masterKey = () => requireHex('ENCRYPTION_MASTER_KEY');

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function deriveKEK(password, salt) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
}

function generateDEK() {
  return crypto.randomBytes(KEY_LENGTH);
}

function wrapKey(rawKey, wrappingKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
  const ciphertext = Buffer.concat([cipher.update(rawKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function unwrapKey(payload, wrappingKey) {
  const [ivB64, tagB64, cipherB64] = String(payload).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherB64, 'base64url')),
    decipher.final(),
  ]);
}

function buildUserKeyset(password) {
  const password_salt = randomHex(16);
  const dek = generateDEK();
  const kek = deriveKEK(password, password_salt);

  return {
    dek,
    password_salt,
    dek_wrapped_by_password: wrapKey(dek, kek),
    dek_wrapped_by_master: wrapKey(dek, masterKey()),
  };
}

async function storeUserKeyset(userId, keyset, { requestId } = {}) {
  await query(
    `INSERT INTO user_encryption_keys
      (id, user_id, password_salt, dek_wrapped_by_password, dek_wrapped_by_master, key_version)
     VALUES (UUID(), ?, ?, ?, ?, 1)`,
    [userId, keyset.password_salt, keyset.dek_wrapped_by_password, keyset.dek_wrapped_by_master],
    { requestId }
  );
}

async function getKeyRecord(userId, { requestId } = {}) {
  const [row] = await query(
    `SELECT * FROM user_encryption_keys WHERE user_id = ? LIMIT 1`,
    [userId],
    { requestId }
  );
  return row || null;
}

async function loadDEKWithPassword(userId, password, { requestId } = {}) {
  const row = await getKeyRecord(userId, { requestId });
  if (!row) throw new Error('User encryption key record not found');
  const kek = deriveKEK(password, row.password_salt);
  return unwrapKey(row.dek_wrapped_by_password, kek);
}

async function loadDEKWithMasterKey(userId, { requestId } = {}) {
  const row = await getKeyRecord(userId, { requestId });
  if (!row) throw new Error('User encryption key record not found');
  return unwrapKey(row.dek_wrapped_by_master, masterKey());
}

module.exports = {
  PBKDF2_ITERATIONS,
  buildUserKeyset,
  storeUserKeyset,
  getKeyRecord,
  loadDEKWithPassword,
  loadDEKWithMasterKey,
  requireHex,
};
