'use strict';

/**
 * AuthService
 *
 * Security design:
 *  - Access tokens:  short-lived (15m), stored in memory on client
 *  - Refresh tokens: long-lived (7d), stored in DB (hashed), HttpOnly cookie
 *  - Refresh rotation: every refresh issues a new refresh token and revokes the old
 *  - Password: bcrypt with 12 rounds
 */

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { userRepository } = require('../repositories');
const { query }  = require('../config/database');
const logger     = require('../config/logger');
const AppError   = require('../utils/app.error');

const {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRY  = '15m',
  JWT_REFRESH_EXPIRY = '7d',
  BCRYPT_ROUNDS      = 12,
} = process.env;

class AuthService {

  // ─── Registration ──────────────────────────────────────────────────────────
  async register(dto, { requestId } = {}) {
    const { email, password, full_name, currency = 'INR', timezone = 'Asia/Kolkata' } = dto;

    const existing = await userRepository.findByEmail(email, { requestId });
    if (existing) throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');

    const password_hash = await bcrypt.hash(password, Number(BCRYPT_ROUNDS));

    const user = await userRepository.create({
      email,
      password_hash,
      full_name,
      currency,
      timezone,
    }, { requestId });

    logger.info('User registered', { userId: user.id, email, requestId });

    const tokens = await this._issueTokens(user, { requestId });
    return { user: this._sanitizeUser(user), ...tokens };
  }

  // ─── Login ─────────────────────────────────────────────────────────────────
  async login(email, password, { requestId } = {}) {
    const user = await userRepository.findByEmail(email, { requestId });

    if (!user) throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logger.warn('Failed login attempt', { email, requestId });
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    await userRepository.updateLastLogin(user.id, { requestId });

    logger.info('User logged in', { userId: user.id, requestId });

    const tokens = await this._issueTokens(user, { requestId });
    return { user: this._sanitizeUser(user), ...tokens };
  }

  // ─── Refresh tokens ────────────────────────────────────────────────────────
  async refreshTokens(rawRefreshToken, { requestId } = {}) {
    let payload;
    try {
      payload = jwt.verify(rawRefreshToken, JWT_REFRESH_SECRET);
    } catch {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const tokenHash = this._hashToken(rawRefreshToken);

    const [stored] = await query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ? AND user_id = ? AND revoked = 0 AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash, payload.sub],
      { requestId }
    );

    if (!stored) throw new AppError('Refresh token not found or expired', 401, 'TOKEN_NOT_FOUND');

    // Revoke old token
    await query(
      `UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`,
      [stored.id],
      { requestId }
    );

    const user = await userRepository.findActiveById(payload.sub, { requestId });
    if (!user) throw new AppError('User not found', 401, 'USER_NOT_FOUND');

    return this._issueTokens(user, { requestId });
  }

  // ─── Logout ────────────────────────────────────────────────────────────────
  async logout(rawRefreshToken, { requestId } = {}) {
    if (!rawRefreshToken) return;
    const tokenHash = this._hashToken(rawRefreshToken);
    await query(
      `UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?`,
      [tokenHash],
      { requestId }
    );
    logger.info('User logged out', { requestId });
  }

  // ─── Verify access token (used by auth middleware) ─────────────────────────
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, JWT_ACCESS_SECRET);
    } catch (err) {
      throw new AppError(
        err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token',
        401,
        'INVALID_ACCESS_TOKEN'
      );
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async _issueTokens(user, { requestId } = {}) {
    const accessToken  = jwt.sign(
      { sub: user.id, email: user.email },
      JWT_ACCESS_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRY }
    );

    const refreshToken = jwt.sign(
      { sub: user.id, jti: uuidv4() },
      JWT_REFRESH_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRY }
    );

    const tokenHash = this._hashToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES (UUID(), ?, ?, ?)`,
      [user.id, tokenHash, expiresAt.toISOString().slice(0, 19)],
      { requestId }
    );

    return { accessToken, refreshToken };
  }

  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  _sanitizeUser(user) {
    const { password_hash, ...safe } = user;
    return safe;
  }
}

module.exports = new AuthService();