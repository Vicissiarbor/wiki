/**
 * Writable source backed by the small Node service in server/ (the aliyun box).
 *
 * Contract (see docs/api.md):
 *   GET    {base}/api/entries        -> {version, updatedAt, revision, entries}
 *   POST   {base}/api/entries        -> same, with the created entry included
 *   PUT    {base}/api/entries/{id}   -> same
 *   DELETE {base}/api/entries/{id}   -> same
 *
 * Every write sends `If-Match: <revision>`; the server answers 409 when another
 * device wrote in the meantime, which surfaces as a ConflictError so the UI can
 * ask the user to reload instead of silently losing an edit.
 */

import { assertWritable, snapshotFromDocument } from './source.js';
import { requestJson } from './http.js';

/**
 * @param {{baseUrl: string, token?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} options
 * @returns {import('./source.js').DataSource}
 */
export function createRestSource(options) {
  const baseUrl = String(options.baseUrl ?? '').replace(/\/+$/, '');
  const token = String(options.token ?? '');
  const timeoutMs = options.timeoutMs ?? 10_000;

  /**
   * @param {string} path
   * @param {{method?: string, body?: unknown, revision?: string}} [request]
   * @returns {Promise<unknown>}
   */
  const call = (path, request = {}) =>
    requestJson(`${baseUrl}${path}`, {
      method: request.method ?? 'GET',
      body: request.body,
      timeoutMs,
      fetchImpl: options.fetchImpl,
      headers: {
        ...(token === '' ? {} : { Authorization: `Bearer ${token}` }),
        ...(request.revision ? { 'If-Match': request.revision } : {}),
      },
    });

  /** @type {import('./source.js').DataSource & {baseUrl: string}} */
  const source = {
    id: 'rest',
    label: '自建后端（可写）',
    description: baseUrl === '' ? '尚未配置后端地址。' : `通过 ${baseUrl} 读写词条，改动立即对所有设备生效。`,
    writable: baseUrl !== '' && token !== '',
    baseUrl,

    async load() {
      const payload = await call('/api/entries');
      return snapshotFromDocument(payload, { origin: baseUrl, source: baseUrl });
    },

    async createEntry(entry, context = {}) {
      assertWritable(source);
      const payload = await call('/api/entries', {
        method: 'POST',
        body: { entry },
        revision: context.revision,
      });
      return snapshotFromDocument(payload, { origin: baseUrl, source: baseUrl });
    },

    async updateEntry(entry, context = {}) {
      assertWritable(source);
      const payload = await call(`/api/entries/${encodeURIComponent(entry.id)}`, {
        method: 'PUT',
        body: { entry },
        revision: context.revision,
      });
      return snapshotFromDocument(payload, { origin: baseUrl, source: baseUrl });
    },

    async deleteEntry(id, context = {}) {
      assertWritable(source);
      const payload = await call(`/api/entries/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        revision: context.revision,
      });
      return snapshotFromDocument(payload, { origin: baseUrl, source: baseUrl });
    },
  };

  return source;
}