/**
 * Tiny HTTP helpers: responses, body parsing, CORS, security headers, logging.
 *
 * The service deliberately uses only node:http — no framework, no dependencies,
 * so deploying on a small aliyun box is `git clone` + `node server/index.js`.
 */

/** An error carrying an HTTP status code, mapped to a JSON body by the caller. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {{code?: string, details?: unknown, headers?: Record<string, string>}} [options]
   */
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = options.code ?? 'error';
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 * @returns {void}
 */
export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    ...securityHeaders(),
    ...headers,
  });
  res.end(body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} text
 * @param {Record<string, string>} [headers]
 * @returns {void}
 */
export function sendText(res, status, text, headers = {}) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(body.length),
    ...securityHeaders(),
    ...headers,
  });
  res.end(body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, string>} [headers]
 * @returns {void}
 */
export function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { 'Content-Length': '0', ...securityHeaders(), ...headers });
  res.end();
}

/**
 * @returns {Record<string, string>} Headers applied to every response.
 */
export function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  };
}

/**
 * Read and parse a JSON request body with a hard size limit.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{limit: number}} options
 * @returns {Promise<unknown>}
 * @throws {HttpError} 413 when too large, 400 when not valid JSON.
 */
export async function readJsonBody(req, options) {
  const limit = options.limit;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, `请求体超过上限（${limit} 字节）。`, { code: 'payload-too-large' });
    }
    chunks.push(chunk);
  }
  if (size === 0) {
    throw new HttpError(400, '请求体为空，期望 JSON。', { code: 'empty-body' });
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, `请求体不是合法 JSON：${/** @type {Error} */ (error).message}`, {
      code: 'invalid-json',
    });
  }
}

/**
 * Apply CORS headers and answer preflight requests.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string[]} allowedOrigins
 * @returns {boolean} True when the request was a preflight that has been answered.
 */
export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  const allowAny = allowedOrigins.includes('*');
  const allowed =
    typeof origin === 'string' && (allowAny || allowedOrigins.includes(origin)) ? origin : '';
  if (allowed !== '') {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
  } else if (allowAny && typeof origin !== 'string') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204);
    return true;
  }
  return false;
}

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 * @returns {void}
 */
export function log(level, message, fields = {}) {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix ? ` ${suffix}` : ''}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * @param {string} level
 * @returns {Record<'debug'|'info'|'warn'|'error', (...args: unknown[]) => void>}
 */
export function createLogger(level) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = order[/** @type {keyof typeof order} */ (level)] ?? 20;
  /**
   * @param {'debug'|'info'|'warn'|'error'} name
   * @returns {(...args: unknown[]) => void}
   */
  const at = (name) => (message, fields) => {
    if (order[name] >= threshold) {
      log(name, String(message), /** @type {any} */ (fields));
    }
  };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}