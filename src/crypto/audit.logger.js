'use strict';

const logger = require('../config/logger');

function logKeyEvent(event, meta = {}) {
  logger.info(`crypto.${event}`, {
    ...meta,
    plaintext: undefined,
    decrypted: undefined,
  });
}

module.exports = {
  logKeyEvent,
};
