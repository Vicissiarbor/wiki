/**
 * The REST API.
 *
 *   GET    /api/health          service and data file status (public)
 *   GET    /api/entries         the whole bundle (public)
 *   POST   /api/entries         create one entry        (Bearer token)
 *   PUT    /api/entries/{id}    replace one entry       (Bearer token)
 *   DELETE /api/entries/{id}    delete one entry        (Bearer token)
 *   POST   /api/entries/import  replace the whole bundle (Bearer token)
 *
 * Writes accept an optional `If-Match: <revision>` header; when it does not
 * match the current revision the API answers 409 so the client can reload
 * instead of silently overwriting another device's edit.
 */

import { ConflictError, ValidationError } from '../../web/js/core/errors.js';
import { HttpError, readJsonBody, sendJson } from './http.js';

/**
 * @typedef {object} ApiDependencies
 * @property {import('./store.js').EntryStore} store
 * @property {{assertAuthorized: (req: import('node:http').IncomingMessage) => void}} auth
 * @property {boolean} writesEnabled
 * @property {number} bodyLimit
 * @property {(level: string, message: string, fields?: object) => void} [log]
 * @property {number} [startedAt]
 */

/** Route table: method plus a pattern with `:id` placeholders. */
const ROUTES = [
  { method: 'GET', pattern: /^\/api\/health$/ },
  { method: 'GET', pattern: /^\/api\/entries$/ },
  { method: 'POST', pattern: /^\/api\/entries$/, write: true },
  { method: 'POST', pattern: /^\/api\/entries\/import$/, write: true },
  { method: 'PUT', pattern: /^\/api\/entries\/([^/]+)$/, write: true, params: ['id'] },
  { method: 'DELETE', pattern: /^\/api\/entries\/([^/]+)$/, write: true, params: ['id'] },
];

/**
 * @param {ApiDependencies} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL) => Promise<boolean>}
 */
export function createApiHandler(deps) {
  const store = deps.store;
  const log = deps.log ?? (() => {});
  const startedAt = deps.startedAt ?? Date.now();

  return async function apiHandler(req, res, url) {
    if (!url.pathname.startsWith('/api/')) {
      return false;
    }
    const route = ROUTES.find(
      (candidate) => candidate.method === req.method && candidate.pattern.test(url.pathname),
    );
    if (!route) {
      throw new HttpError(404, `没有这个接口：${req.method} ${url.pathname}`, { code: 'not-found' });
    }

    if (route.write) {
      if (!deps.writesEnabled) {
        throw new HttpError(403, '服务端处于只读模式（未配置 LADR_TOKEN）。', {
          code: 'read-only',
        });
      }
      deps.auth.assertAuthorized(req);
    }

    const matches = route.pattern.exec(url.pathname) ?? [];
    /** @type {Record<string, string>} */
    const params = {};
    for (const [index, name] of (route.params ?? []).entries()) {
      params[name] = decodeURIComponent(matches[index + 1] ?? '');
    }
    const ifMatch = headerValue(req.headers['if-match']);

    if (route.method === 'GET' && url.pathname === '/api/health') {
      const stats = await store.stats();
      sendJson(res, 200, {
        ok: true,
        service: 'searchladr',
        writable: deps.writesEnabled,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        dataFile: store.file,
        ...stats,
      });
      return true;
    }

    if (route.method === 'GET') {
      const snapshot = await store.snapshot();
      sendJson(res, 200, snapshot, { ETag: `"${snapshot.revision}"` });
      return true;
    }

    if (route.method === 'POST' && url.pathname === '/api/entries') {
      const body = await readJsonBody(req, { limit: deps.bodyLimit });
      const result = await store.createEntry(unwrapEntry(body), { ifMatch });
      log('info', '新增词条', { id: result.created?.id, name: result.created?.name });
      sendJson(res, 201, result, { ETag: `"${result.revision}"` });
      return true;
    }

    if (route.method === 'POST' && url.pathname === '/api/entries/import') {
      const body = await readJsonBody(req, { limit: deps.bodyLimit });
      const document = /** @type {any} */ (body)?.document ?? body;
      const result = await store.replaceDocument(document, { ifMatch });
      log('info', '整体导入词条', { entries: result.entries.length });
      sendJson(res, 200, result, { ETag: `"${result.revision}"` });
      return true;
    }

    if (route.method === 'PUT') {
      const body = await readJsonBody(req, { limit: deps.bodyLimit });
      const entry = unwrapEntry(body);
      const result = await store.updateEntry(params.id, { ...entry, id: params.id }, { ifMatch });
      if (result.updated === null) {
        throw new HttpError(404, `没有 id 为 ${params.id} 的词条。`, { code: 'not-found' });
      }
      log('info', '更新词条', { id: params.id, name: result.updated.name });
      sendJson(res, 200, result, { ETag: `"${result.revision}"` });
      return true;
    }

    if (route.method === 'DELETE') {
      const result = await store.deleteEntry(params.id, { ifMatch });
      if (result.removed === null) {
        throw new HttpError(404, `没有 id 为 ${params.id} 的词条。`, { code: 'not-found' });
      }
      log('info', '删除词条', { id: params.id, name: result.removed.name });
      sendJson(res, 200, result, { ETag: `"${result.revision}"` });
      return true;
    }

    throw new HttpError(405, `不支持的方法：${req.method}`, { code: 'method-not-allowed' });
  };
}

/**
 * @param {unknown} body
 * @returns {unknown} The entry payload, accepting `{entry: …}` or a bare entry.
 */
function unwrapEntry(body) {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const wrapper = /** @type {Record<string, unknown>} */ (body);
    if (wrapper.entry !== undefined) {
      return wrapper.entry;
    }
  }
  return body;
}

/**
 * @param {string|string[]|undefined} value
 * @returns {string}
 */
function headerValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return (value ?? '').replace(/^W\//, '').replace(/^"|"$/g, '');
}

/**
 * Map a thrown error onto a JSON response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} error
 * @param {(level: string, message: string, fields?: object) => void} log
 * @returns {boolean} Always true (the error has been answered).
 */
export function handleApiError(res, error, log) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { message: error.message, code: error.code }, error.headers);
    return true;
  }
  if (error instanceof ConflictError) {
    sendJson(
      res,
      409,
      {
        message: error.message,
        code: 'conflict',
        expected: error.expected,
        actual: error.actual,
      },
      { ETag: error.actual ? `"${error.actual}"` : '' },
    );
    return true;
  }
  if (error instanceof ValidationError) {
    sendJson(res, 422, {
      message: error.describe(),
      code: 'invalid-entry',
      issues: error.issues,
    });
    return true;
  }
  log('error', '未处理的错误', { error: error instanceof Error ? error.stack : String(error) });
  sendJson(res, 500, { message: '服务器内部错误。', code: 'internal' });
  return true;
}