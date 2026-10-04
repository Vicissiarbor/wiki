/**
 * Writable source that keeps entries in this browser's localStorage.
 *
 * Useful without any backend at all: add and edit entries, then export the JSON
 * file and commit it (the export button in the editor). It also gives offline
 * editing on a device that already loaded the site.
 */

import { EntryCollection } from '../core/collection.js';
import { DataSourceError } from '../core/errors.js';
import { requestJson } from './http.js';
import { createSnapshot, revisionOf, snapshotFromDocument } from './source.js';

/** Storage key holding the whole document. */
export const LOCAL_DOCUMENT_KEY = 'entries.local.v1';

/**
 * @param {{storage: {get: Function, set: Function, remove: Function},
 *   seedUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} options
 * @returns {import('./source.js').DataSource & {
 *   replaceDocument: (raw: unknown) => import('./source.js').SourceSnapshot,
 *   clear: () => void,
 * }}
 */
export function createLocalSource(options) {
  const { storage } = options;
  const timeoutMs = options.timeoutMs ?? 10_000;

  /**
   * @param {EntryCollection} collection
   * @returns {import('./source.js').SourceSnapshot}
   */
  const persist = (collection) => {
    const document = collection.toDocument({ updatedAt: new Date().toISOString() });
    storage.set(LOCAL_DOCUMENT_KEY, document);
    return createSnapshot(collection, {
      revision: revisionOf(document),
      origin: 'localStorage',
    });
  };

  /** @type {import('./source.js').DataSource & {replaceDocument: Function, clear: Function}} */
  const source = {
    id: 'local',
    label: '本地编辑（仅此设备）',
    description:
      '修改只保存在当前浏览器的 localStorage 中，可用“导出 JSON”把结果提交到仓库。适合离线改稿。',
    writable: true,

    async load() {
      const stored = storage.get(LOCAL_DOCUMENT_KEY, null);
      if (stored !== null) {
        return snapshotFromDocument(stored, { origin: 'localStorage', source: 'localStorage' });
      }
      if (options.seedUrl) {
        try {
          const payload = await requestJson(options.seedUrl, {
            fetchImpl: options.fetchImpl,
            timeoutMs,
          });
          const snapshot = snapshotFromDocument(payload, {
            origin: 'localStorage',
            source: options.seedUrl,
          });
          storage.set(LOCAL_DOCUMENT_KEY, snapshot.collection.toDocument());
          return snapshot;
        } catch (error) {
          throw error instanceof DataSourceError
            ? error
            : new DataSourceError('本地数据初始化失败。', { cause: error, kind: 'internal' });
        }
      }
      return createSnapshot(EntryCollection.fromEntries([]), { origin: 'localStorage' });
    },

    async createEntry(entry, context = {}) {
      const collection = context.collection ?? EntryCollection.fromEntries([]);
      return persist(collection.withEntry(entry));
    },

    async updateEntry(entry, context = {}) {
      const collection = context.collection ?? EntryCollection.fromEntries([]);
      return persist(collection.withEntry(entry));
    },

    async deleteEntry(id, context = {}) {
      const collection = context.collection ?? EntryCollection.fromEntries([]);
      return persist(collection.withoutEntry(id));
    },

    /**
     * Replace everything (JSON import / "overwrite from file").
     *
     * @param {unknown} raw
     * @returns {import('./source.js').SourceSnapshot}
     */
    replaceDocument(raw) {
      const { collection, issues } = EntryCollection.fromDocument(raw, { source: '导入的 JSON' });
      const snapshot = persist(collection);
      return { ...snapshot, issues };
    },

    /** Forget the local copy (used when switching back to the shared bundle). */
    clear() {
      storage.remove(LOCAL_DOCUMENT_KEY);
    },
  };

  return source;
}