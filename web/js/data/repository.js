/**
 * Repository: the single place the UI talks to for entry data.
 *
 * Responsibilities
 *   - own the current DataSource and its in-memory snapshot;
 *   - paint instantly from a localStorage cache, then refresh from the network;
 *   - apply writes optimistically and roll back when the source rejects them;
 *   - serialize writes so two quick saves cannot interleave;
 *   - notify subscribers (the views) whenever the state changes.
 *
 * It never touches the DOM, which is what keeps it unit-testable.
 */

import { EntryCollection } from '../core/collection.js';
import { ConflictError, DataSourceError, describeError } from '../core/errors.js';
import { createSource } from './registry.js';

/** Cache key prefix: one cached snapshot per source kind. */
const CACHE_PREFIX = 'cache.';

/**
 * @typedef {object} RepositoryState
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {true|false} stale True while cached data is shown during a refresh.
 * @property {EntryCollection} collection
 * @property {string} sourceId
 * @property {string} sourceLabel
 * @property {boolean} writable
 * @property {string} revision
 * @property {string} origin
 * @property {string} fetchedAt
 * @property {string} updatedAt
 * @property {Array<{index: number, message: string}>} issues
 * @property {string} error
 * @property {string} errorKind
 * @property {boolean} pending True while a write is in flight.
 * @property {string[]} warnings
 */

export class EntryRepository {
  /**
   * @param {{config: import('../config.js').AppConfig,
   *   storage: {get: Function, set: Function, remove: Function},
   *   fetchImpl?: typeof fetch, warnings?: string[],
   *   source?: import('./source.js').DataSource}} options
   *   `source` overrides the configured data source (dependency injection,
   *   used by the test suite).
   */
  constructor(options) {
    this.config = options.config;
    this.storage = options.storage;
    this.fetchImpl = options.fetchImpl;
    this.warnings = options.warnings ?? [];
    /** @type {import('./source.js').DataSource} */
    this.source =
      options.source ??
      createSource(this.config, { storage: this.storage, fetchImpl: this.fetchImpl });
    /** @type {RepositoryState} */
    this.state = {
      status: 'idle',
      stale: false,
      collection: EntryCollection.fromEntries([]),
      sourceId: this.source.id,
      sourceLabel: this.source.label,
      writable: this.source.writable,
      revision: '',
      origin: '',
      fetchedAt: '',
      updatedAt: '',
      issues: [],
      error: '',
      errorKind: '',
      pending: false,
      warnings: this.warnings,
    };
    /** @type {Set<(state: RepositoryState) => void>} */
    this.listeners = new Set();
    this.writeChain = Promise.resolve();
    this.refreshToken = 0;
  }

  /**
   * @param {(state: RepositoryState) => void} listener
   * @returns {() => void} Unsubscribe.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * @param {Partial<RepositoryState>} patch
   * @returns {RepositoryState} The new state.
   */
  patchState(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        // A broken view must not stop the others from updating.
        console.error('[ladr] listener failed', error);
      }
    }
    return this.state;
  }

  /** @returns {EntryCollection} */
  get collection() {
    return this.state.collection;
  }

  /** @returns {string} Cache key for the active source. */
  get cacheKey() {
    return `${CACHE_PREFIX}${this.source.id}.v1`;
  }

  /**
   * Load the cached snapshot (instant paint), then refresh from the source.
   *
   * @param {{refresh?: boolean}} [options]
   * @returns {Promise<RepositoryState>}
   */
  async init(options = {}) {
    const cached = this.storage.get(this.cacheKey, null);
    if (cached && typeof cached === 'object' && Array.isArray(cached.entries)) {
      const { collection } = EntryCollection.fromDocument(cached, { source: '本地缓存' });
      this.patchState({
        status: 'ready',
        stale: true,
        collection,
        revision: String(cached.revision ?? ''),
        origin: String(cached.origin ?? ''),
        fetchedAt: String(cached.fetchedAt ?? ''),
        updatedAt: String(cached.updatedAt ?? ''),
      });
    } else {
      this.patchState({ status: 'loading' });
    }
    return this.refresh(options);
  }

  /**
   * Reload from the active source.
   *
   * @param {{refresh?: boolean}} [options] `refresh` bypasses HTTP caches.
   * @returns {Promise<RepositoryState>}
   */
  async refresh(options = {}) {
    const token = ++this.refreshToken;
    this.patchState({ status: this.state.collection.isEmpty ? 'loading' : 'ready', stale: true });
    try {
      const snapshot = await this.source.load({ refresh: options.refresh === true });
      if (token !== this.refreshToken) {
        return this.state; // A newer refresh already answered.
      }
      this.cache(snapshot);
      return this.patchState({
        status: 'ready',
        stale: false,
        collection: snapshot.collection,
        revision: snapshot.revision,
        origin: snapshot.origin,
        fetchedAt: snapshot.fetchedAt,
        updatedAt: snapshot.collection.updatedAt,
        issues: snapshot.issues,
        error: '',
        errorKind: '',
      });
    } catch (error) {
      if (token !== this.refreshToken) {
        return this.state;
      }
      const hasData = !this.state.collection.isEmpty;
      return this.patchState({
        status: hasData ? 'ready' : 'error',
        stale: hasData,
        error: describeError(error),
        errorKind: error instanceof DataSourceError ? error.kind ?? 'unknown' : 'unknown',
      });
    }
  }

  /**
   * @param {import('./source.js').SourceSnapshot} snapshot
   * @returns {void}
   */
  cache(snapshot) {
    this.storage.set(this.cacheKey, {
      ...snapshot.collection.toDocument(),
      revision: snapshot.revision,
      origin: snapshot.origin,
      fetchedAt: snapshot.fetchedAt,
    });
  }

  /**
   * Switch to another data source (settings dialog).
   *
   * @param {Partial<import('../config.js').AppConfig>} configPatch
   * @param {{refresh?: boolean}} [options]
   * @returns {Promise<RepositoryState>}
   */
  async setConfig(configPatch, options = {}) {
    this.config = { ...this.config, ...configPatch };
    this.source = createSource(this.config, { storage: this.storage, fetchImpl: this.fetchImpl });
    this.patchState({
      sourceId: this.source.id,
      sourceLabel: this.source.label,
      writable: this.source.writable,
      error: '',
      errorKind: '',
      collection: EntryCollection.fromEntries([]),
      status: 'loading',
      stale: false,
    });
    return this.init(options);
  }

  /**
   * Create or update one entry.
   *
   * The change is applied locally first so the UI answers immediately; when the
   * source rejects it (validation, conflict, offline) the previous snapshot is
   * restored and the error is rethrown for the editor to display.
   *
   * @param {import('../core/entry.js').Entry} entry
   * @returns {Promise<{collection: EntryCollection, created: boolean}>}
   */
  saveEntry(entry) {
    return this.enqueueWrite(async () => {
      const previous = this.state;
      const created = !previous.collection.has(entry.id);
      const optimistic = previous.collection.withEntry(entry);
      this.patchState({ collection: optimistic, pending: true, error: '', errorKind: '' });
      try {
        const snapshot = created
          ? await this.source.createEntry(entry, {
              revision: previous.revision,
              collection: previous.collection,
            })
          : await this.source.updateEntry(entry, {
              revision: previous.revision,
              collection: previous.collection,
            });
        this.cache(snapshot);
        this.patchState({
          collection: snapshot.collection,
          revision: snapshot.revision,
          origin: snapshot.origin,
          fetchedAt: snapshot.fetchedAt,
          updatedAt: snapshot.collection.updatedAt,
          issues: snapshot.issues,
          pending: false,
          error: '',
          errorKind: '',
        });
        return { collection: snapshot.collection, created };
      } catch (error) {
        this.patchState({
          collection: previous.collection,
          revision: previous.revision,
          pending: false,
          error: describeError(error),
          errorKind: error instanceof ConflictError ? 'conflict' : 'write',
        });
        throw error;
      }
    });
  }

  /**
   * Delete one entry by id.
   *
   * @param {string} id
   * @returns {Promise<{collection: EntryCollection}>}
   */
  deleteEntry(id) {
    return this.enqueueWrite(async () => {
      const previous = this.state;
      this.patchState({
        collection: previous.collection.withoutEntry(id),
        pending: true,
        error: '',
        errorKind: '',
      });
      try {
        const snapshot = await this.source.deleteEntry(id, {
          revision: previous.revision,
          collection: previous.collection,
        });
        this.cache(snapshot);
        this.patchState({
          collection: snapshot.collection,
          revision: snapshot.revision,
          origin: snapshot.origin,
          fetchedAt: snapshot.fetchedAt,
          updatedAt: snapshot.collection.updatedAt,
          issues: snapshot.issues,
          pending: false,
        });
        return { collection: snapshot.collection };
      } catch (error) {
        this.patchState({
          collection: previous.collection,
          revision: previous.revision,
          pending: false,
          error: describeError(error),
          errorKind: error instanceof ConflictError ? 'conflict' : 'write',
        });
        throw error;
      }
    });
  }

  /**
   * Replace the whole collection (JSON import on writable sources).
   *
   * @param {unknown} raw
   * @returns {Promise<RepositoryState>}
   */
  async importDocument(raw) {
    return this.enqueueWrite(async () => {
      const replace = /** @type {{replaceDocument?: Function}} */ (this.source).replaceDocument;
      if (typeof replace !== 'function') {
        throw new DataSourceError(
          '当前数据源不支持整体导入。请切换到“本地编辑”后再导入，或直接编辑服务器上的 JSON 文件。',
          { kind: 'unsupported' },
        );
      }
      const snapshot = /** @type {import('./source.js').SourceSnapshot} */ (replace.call(this.source, raw));
      this.cache(snapshot);
      return this.patchState({
        collection: snapshot.collection,
        revision: snapshot.revision,
        origin: snapshot.origin,
        fetchedAt: snapshot.fetchedAt,
        updatedAt: snapshot.collection.updatedAt,
        issues: snapshot.issues,
        pending: false,
      });
    });
  }

  /**
   * @returns {{version: number, updatedAt: string, entries: import('../core/entry.js').Entry[]}}
   */
  exportDocument() {
    return this.collection.toDocument();
  }

  /**
   * Run `task` after every previously queued write.
   *
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  enqueueWrite(task) {
    const run = this.writeChain.then(task, task);
    // Keep the chain alive regardless of the outcome of this write.
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}