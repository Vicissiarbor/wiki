/**
 * The entries store: load `data/entries.json` once, keep it in memory, and keep
 * a copy in localStorage so the index paints instantly on the next visit.
 *
 * The site is read-only by design: content is maintained by committing the JSON
 * file to the repository (see docs/data-format.md). There is no write path, no
 * token, and therefore nothing that can be abused from the outside.
 */

import { EntryCollection } from '../core/collection.js';
import { DataSourceError } from '../core/errors.js';
import { createTranslator } from '../core/i18n.js';

/** localStorage key of the cached bundle. */
export const CACHE_KEY = 'cache.entries.v1';

/**
 * @typedef {object} EntriesState
 * @property {'loading'|'ready'|'error'} status
 * @property {EntryCollection} collection
 * @property {Array<{index: number, message: string}>} issues
 * @property {string} error User-facing error message ('' when fine).
 * @property {'network'|'http'|'format'|'missing'|''} errorKind
 * @property {string} fetchedAt ISO timestamp of the last successful load.
 * @property {boolean} fromCache True while the shown data comes from the cache.
 * @property {boolean} stale True when a refresh is in flight over cached data.
 */

/**
 * @typedef {object} EntriesStore
 * @property {() => EntriesState} getState
 * @property {() => EntryCollection} getCollection
 * @property {(listener: (state: EntriesState) => void) => (() => void)} subscribe
 * @property {(options?: {refresh?: boolean}) => Promise<EntriesState>} load
 */

/**
 * @param {{url: string, storage: {get: Function, set: Function}, fetchImpl?: typeof fetch,
 *   timeoutMs?: number, t?: (key: string, params?: Record<string, unknown>) => string}} options
 * @returns {EntriesStore}
 */
export function createEntriesStore(options) {
  const url = options.url;
  const storage = options.storage;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  /** Messages follow the interface language; the store can be re-translated. */
  const t = (/** @type {string} */ key, /** @type {Record<string, unknown>} */ params) =>
    (options.t ?? createTranslator('en'))(key, params);

  /** @type {EntriesState} */
  let state = {
    status: 'loading',
    collection: EntryCollection.fromEntries([]),
    issues: [],
    error: '',
    errorKind: '',
    fetchedAt: '',
    fromCache: false,
    stale: false,
  };
  /** @type {Set<(state: EntriesState) => void>} */
  const listeners = new Set();
  let token = 0;

  /**
   * @param {Partial<EntriesState>} patch
   * @returns {EntriesState}
   */
  const commit = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('[ladr] listener failed', error);
      }
    }
    return state;
  };

  /**
   * @param {boolean} refresh Bypass the HTTP cache (used by "重新加载").
   * @returns {Promise<unknown>} The parsed bundle.
   */
  async function download(refresh) {
    if (typeof fetchImpl !== 'function') {
      throw new DataSourceError(t('status.issueHint.http'), { kind: 'format' });
    }
    if (typeof AbortController !== 'function') {
      const response = await fetchImpl(url, { cache: refresh ? 'no-store' : 'no-cache' });
      return readResponse(response);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        cache: refresh ? 'no-store' : 'no-cache',
        signal: controller.signal,
      });
      return await readResponse(response);
    } catch (error) {
      if (error instanceof DataSourceError) {
        throw error;
      }
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new DataSourceError(
        aborted ? t('store.timeout', { url }) : t('store.unreachable', { url }),
        { kind: 'network', cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {Response} response
   * @returns {Promise<unknown>}
   */
  async function readResponse(response) {
    if (!response.ok) {
      throw new DataSourceError(
        response.status === 404
          ? t('store.notFound', { url })
          : t('store.httpError', { status: response.status, url }),
        { kind: response.status === 404 ? 'missing' : 'http' },
      );
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new DataSourceError(t('store.notJson', { url }), { kind: 'format', cause: error });
    }
  }

  return {
    getState: () => state,
    getCollection: () => state.collection,

    /**
     * Switch the language used for load errors (the UI re-renders on a switch).
     *
     * @param {(key: string, params?: Record<string, unknown>) => string} translate
     * @returns {void}
     */
    setTranslator(translate) {
      // eslint-disable-next-line no-param-reassign
      options.t = translate;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Paint from the cache (when present), then read the file again.
     *
     * @param {{refresh?: boolean}} [loadOptions]
     * @returns {Promise<EntriesState>}
     */
    async load(loadOptions = {}) {
      const current = ++token;

      if (state.status === 'loading' && state.collection.isEmpty) {
        const cached = storage.get(CACHE_KEY, null);
        if (cached && typeof cached === 'object' && Array.isArray(cached.entries)) {
          const { collection, issues } = EntryCollection.fromDocument(cached, {
            source: '本地缓存',
          });
          commit({
            status: 'ready',
            collection,
            issues,
            fetchedAt: String(cached.fetchedAt ?? ''),
            fromCache: true,
            stale: true,
          });
        }
      } else {
        commit({ stale: true });
      }

      try {
        const raw = await download(loadOptions.refresh === true);
        if (current !== token) {
          return state; // A newer load already answered.
        }
        const { collection, issues } = EntryCollection.fromDocument(raw, { source: url });
        const fetchedAt = new Date().toISOString();
        storage.set(CACHE_KEY, { ...collection.toDocument(), fetchedAt });
        return commit({
          status: 'ready',
          collection,
          issues,
          error: '',
          errorKind: '',
          fetchedAt,
          fromCache: false,
          stale: false,
        });
      } catch (error) {
        if (current !== token) {
          return state;
        }
        const hasData = !state.collection.isEmpty;
        return commit({
          status: hasData ? 'ready' : 'error',
          stale: false,
          error: error instanceof Error ? error.message : String(error),
          errorKind: /** @type {any} */ (error instanceof DataSourceError ? error.kind : ''),
        });
      }
    },
  };
}