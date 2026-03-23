'use strict';

const { encryptValue, decryptValue } = require('./encryption.engine');
const keyManager = require('./key.manager');
const { createBlindIndex } = require('./blind.index');
const { encryptEntity, decryptEntity, FIELD_CONFIG } = require('./field.encryptor');
const { logKeyEvent } = require('./audit.logger');

function validateCryptoEnv() {
  if (!keyManager.hasServerSideEncryption()) return;
  keyManager.requireHex('ENCRYPTION_MASTER_KEY');
  keyManager.requireHex('BLIND_INDEX_SECRET');
}

module.exports = {
  encryptValue,
  decryptValue,
  createBlindIndex,
  encryptEntity,
  decryptEntity,
  FIELD_CONFIG,
  keyManager,
  logKeyEvent,
  validateCryptoEnv,
};
