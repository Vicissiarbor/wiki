/**
 * Test helpers: browser-like doubles for the static site.
 *
 * There is no server to fake any more — the only I/O the site performs is
 * reading one JSON file, so these helpers stay deliberately small.
 */

import { createStorage } from '../../web/js/util/storage.js';

/**
 * @returns {ReturnType<typeof createStorage>} Storage that never touches localStorage.
 */
export function memoryStorage() {
  return createStorage('ladr-test', { memoryOnly: true });
}

/**
 * Build a `fetch` replacement that answers from a routing table.
 *
 * @param {Record<string, {status?: number, body?: unknown} | ((url: string, init: RequestInit) => {status?: number, body?: unknown})>} routes
 * @returns {{fetch: typeof fetch, calls: Array<{url: string, method: string, cache: string|undefined}>}}
 */
export function createFetchStub(routes) {
  /** @type {Array<{url: string, method: string, cache: string|undefined}>} */
  const calls = [];

  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, cache: init.cache });
    const route = routes[url] ?? routes['*'];
    if (route === undefined) {
      return response({ message: 'not found' }, 404);
    }
    const resolved = typeof route === 'function' ? route(url, init) : route;
    return response(resolved.body ?? null, resolved.status ?? 200);
  };

  return { fetch: /** @type {typeof fetch} */ (fetchImpl), calls };
}

/**
 * @param {unknown} body
 * @param {number} status
 * @returns {Response} A minimal Response double.
 */
export function response(body, status = 200) {
  const text = body === null ? '' : JSON.stringify(body);
  return /** @type {Response} */ ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(text);
    },
    async text() {
      return text;
    },
  });
}

/**
 * A `fetch` that always fails the way an offline browser does.
 *
 * @param {Error} error
 * @returns {typeof fetch}
 */
export function failingFetch(error) {
  return /** @type {typeof fetch} */ (async () => {
    throw error;
  });
}