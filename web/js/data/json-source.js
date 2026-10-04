/**
 * Read-only source: the JSON bundle shipped next to the page.
 *
 * This is the default. It works on GitHub Pages, needs no server and no token,
 * and is what makes "多设备查找" work out of the box: every device reads the
 * same committed file.
 */

import { DataSourceError } from '../core/errors.js';
import { requestJson } from './http.js';
import { assertWritable, snapshotFromDocument } from './source.js';

/**
 * @param {{url: string, fetchImpl?: typeof fetch, timeoutMs?: number, cacheBust?: boolean}} options
 * @returns {import('./source.js').DataSource}
 */
export function createJsonSource(options) {
  const url = options.url;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const cacheBust = options.cacheBust === true;

  /**
   * @param {boolean} refresh Append a timestamp so a CDN/proxy cannot answer stale.
   * @returns {string}
   */
  const urlFor = (refresh) => {
    if (!cacheBust && !refresh) {
      return url;
    }
    return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
  };

  /** @type {import('./source.js').DataSource} */
  const source = {
    id: 'json',
    label: '静态 JSON（只读）',
    description: `读取站点自带的 ${url}。任何人打开网页即可查询，但不能在网页里修改。`,
    writable: false,

    async load(loadOptions = {}) {
      const refresh = loadOptions.refresh === true;
      let payload;
      try {
        payload = await requestJson(urlFor(refresh), {
          fetchImpl: options.fetchImpl,
          timeoutMs,
          cache: refresh ? 'no-store' : 'no-cache',
        });
      } catch (error) {
        if (error instanceof DataSourceError && error.status === 404) {
          throw new DataSourceError(`找不到词条文件 ${url}（HTTP 404）。请确认已提交该文件。`, {
            url,
            status: 404,
            kind: 'missing',
          });
        }
        throw error;
      }
      return snapshotFromDocument(payload, { origin: url, source: url });
    },

    async createEntry() {
      assertWritable(source);
    },

    async updateEntry() {
      assertWritable(source);
    },

    async deleteEntry() {
      assertWritable(source);
    },
  };

  return source;
}