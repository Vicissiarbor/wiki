/**
 * Bearer-token authentication for the write endpoints.
 *
 * The token is compared in constant time, and repeated failures from one IP are
 * throttled. Reads stay public: the same data is published on GitHub Pages
 * anyway, so protecting reads would add no security.
 */

import crypto from 'node:crypto';
import { HttpError } from './http.js';

/**
 * @param {string} provided
 * @param {string} expected
 * @returns {boolean} Constant-time comparison that tolerates length differences.
 */
export function tokenMatches(provided, expected) {
  if (provided === '' || expected === '') {
    return false;
  }
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Still compare something of the same length to avoid an early exit.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {{token: string, maxFailures?: number, windowMs?: number}} options
 * @returns {{assertAuthorized: (req: import('node:http').IncomingMessage) => void,
 *   noteFailure: (ip: string) => void, reset: (ip: string) => void}}
 */
export function createAuthGate(options) {
  const token = options.token;
  const maxFailures = options.maxFailures ?? 8;
  const windowMs = options.windowMs ?? 60_000;
  /** @type {Map<string, {count: number, firstAt: number, blockedUntil: number}>} */
  const failures = new Map();

  return {
    assertAuthorized(req) {
      const ip = req.socket.remoteAddress ?? 'unknown';
      const record = failures.get(ip);
      if (record && record.blockedUntil > Date.now()) {
        const retryAfter = Math.ceil((record.blockedUntil - Date.now()) / 1000);
        throw new HttpError(429, '认证失败次数过多，请稍后再试。', {
          code: 'too-many-attempts',
          headers: { 'Retry-After': String(retryAfter) },
        });
      }
      const header = req.headers.authorization ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!tokenMatches(provided, token)) {
        this.noteFailure(ip);
        throw new HttpError(401, '缺少或错误的访问令牌。', { code: 'unauthorized' });
      }
      this.reset(ip);
    },

    noteFailure(ip) {
      const now = Date.now();
      const record = failures.get(ip);
      if (!record || now - record.firstAt > windowMs) {
        failures.set(ip, { count: 1, firstAt: now, blockedUntil: 0 });
        return;
      }
      record.count += 1;
      if (record.count >= maxFailures) {
        record.blockedUntil = now + windowMs;
        record.count = 0;
        record.firstAt = now;
      }
    },

    reset(ip) {
      failures.delete(ip);
    },
  };
}