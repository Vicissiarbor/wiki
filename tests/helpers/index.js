/**
 * Test helpers: temporary directories and browser-like doubles.
 *
 * Temporary paths stay inside the repository (`.tools/tmp/`) so the suite works
 * in sandboxes where only the workspace is writable.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStorage } from '../../web/js/util/storage.js';

/**
 * @param {string} name
 * @returns {Promise<string>} A fresh directory path.
 */
export async function makeTempDir(name) {
  const base = process.env.LADR_TEST_TMP ?? path.join(process.cwd(), '.tools', 'tmp');
  const dir = path.join(base, `${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function removeTempDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

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
 * @returns {{fetch: typeof fetch, calls: Array<{url: string, method: string, headers: Record<string, string>, body: unknown}>}}
 */
export function createFetchStub(routes) {
  /** @type {Array<{url: string, method: string, headers: Record<string, string>, body: unknown}>} */
  const calls = [];

  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [key, value] of Object.entries(/** @type {Record<string, string>} */ (init.headers ?? {}))) {
      headers[key.toLowerCase()] = value;
    }
    calls.push({
      url,
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    const route = routes[url] ?? routes[`${method} ${url}`] ?? routes['*'];
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
    headers: new Map(),
    async json() {
      return JSON.parse(text);
    },
    async text() {
      return text;
    },
  });
}

/**
 * A `fetch` that always fails the way a CORS/mixed-content block does.
 *
 * @param {Error} error
 * @returns {typeof fetch}
 */
export function failingFetch(error) {
  return /** @type {typeof fetch} */ (async () => {
    throw error;
  });
}

export { os };