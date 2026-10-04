/**
 * Static file handler for the frontend.
 *
 * Serving web/ from the same origin as the API is what makes the self-hosted
 * deployment "just work" in a browser: the HTTPS GitHub Pages page cannot call
 * an HTTP backend (mixed content), but a page served by the backend itself can.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { sendEmpty, sendText } from './http.js';

/** Extension -> content type. Everything else is served as an octet stream. */
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

/** Files that must always be revalidated (they change with each deploy). */
const NO_CACHE_EXTENSIONS = new Set(['.html', '.json']);

/**
 * @param {{root: string, notFoundFile?: string, log?: (level: string, message: string, fields?: object) => void}} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL) => Promise<boolean>}
 *   A handler that returns true when it produced a response.
 */
export function createStaticHandler(options) {
  const root = path.resolve(options.root);
  const log = options.log ?? (() => {});

  /**
   * @param {string} pathname
   * @returns {string|null} An absolute path inside `root`, or null when unsafe.
   */
  const resolveSafe = (pathname) => {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) {
      return null;
    }
    const relative = decoded.replace(/^\/+/, '');
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return null;
    }
    return resolved;
  };

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {string} file
   * @param {import('node:fs').Stats} stats
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<boolean>}
   */
  const serveFile = async (res, file, stats, req) => {
    const extension = path.extname(file).toLowerCase();
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      sendEmpty(res, 304, { ETag: etag });
      return true;
    }
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      ETag: etag,
      'Last-Modified': stats.mtime.toUTCString(),
      'Cache-Control': NO_CACHE_EXTENSIONS.has(extension)
        ? 'no-cache'
        : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };

  return async function staticHandler(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return false;
    }
    const file = resolveSafe(url.pathname);
    if (file === null) {
      sendText(res, 400, '非法的请求路径');
      return true;
    }

    /** @type {string} */
    let candidate = file;
    try {
      let stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        candidate = path.join(candidate, 'index.html');
        stats = await fs.stat(candidate);
      }
      if (!stats.isFile()) {
        return false;
      }
      return await serveFile(res, candidate, stats, req);
    } catch {
      // Fall back to the SPA's 404 page, like GitHub Pages does.
      const fallback = options.notFoundFile ?? path.join(root, '404.html');
      try {
        const stats = await fs.stat(fallback);
        log('debug', '静态资源未找到，返回 404 页面', { path: url.pathname });
        res.statusCode = 404;
        return await serve404(res, fallback, stats, req);
      } catch {
        return false;
      }
    }
  };

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {string} file
   * @param {import('node:fs').Stats} stats
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<boolean>}
   */
  async function serve404(res, file, stats, req) {
    const body = await fs.readFile(file);
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-cache',
      ETag: `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }
}