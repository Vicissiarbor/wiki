import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CACHE_KEY, createEntriesStore } from '../web/js/data/entries-store.js';
import { memoryStorage, createFetchStub, failingFetch } from './helpers/index.js';

const BUNDLE = {
  version: 1,
  updatedAt: '2025-01-01T00:00:00.000Z',
  entries: [
    { id: 'entropy', name: '熵', aliases: ['entropy'], tags: ['物理'], summary: 's', content: 'c' },
    { id: 'enthalpy', name: '焓' },
  ],
};

const URL_UNDER_TEST = './data/entries.json';

/**
 * @param {{bundle?: unknown, status?: number, failing?: boolean, storage?: any}} [options]
 */
function makeStore(options = {}) {
  const storage = options.storage ?? memoryStorage();
  const { fetch, calls } = createFetchStub({
    [URL_UNDER_TEST]:
      options.failing === true
        ? undefined
        : { status: options.status ?? 200, body: options.bundle ?? BUNDLE },
  });
  const store = createEntriesStore({
    url: URL_UNDER_TEST,
    storage,
    fetchImpl: options.failing === true ? failingFetch(new TypeError('Failed to fetch')) : fetch,
    timeoutMs: 50,
  });
  return { store, storage, calls };
}

describe('entries store - loading', () => {
  it('speaks the interface language for its own messages', async () => {
    const { createTranslator } = await import('../web/js/core/i18n.js');
    const storage = memoryStorage();
    const { fetch } = createFetchStub({ [URL_UNDER_TEST]: { status: 404, body: {} } });
    const store = createEntriesStore({
      url: URL_UNDER_TEST,
      storage,
      fetchImpl: fetch,
      t: createTranslator('zh'),
    });
    await store.load();
    assert.match(store.getState().error, /找不到词条文件/);
  });

  it('starts loading, then reports the parsed bundle', async () => {
    const { store } = makeStore();
    const seen = [];
    store.subscribe((state) => seen.push(state.status));

    assert.equal(store.getState().status, 'loading');
    await store.load();

    assert.equal(store.getState().status, 'ready');
    assert.equal(store.getCollection().size, 2);
    assert.equal(store.getCollection().byId('entropy').name, '熵');
    assert.deepEqual(store.getState().issues, []);
    assert.equal(store.getState().error, '');
    assert.match(seen.join(','), /ready/);
  });

  it('requests the configured relative URL without caching surprises', async () => {
    const { store, calls } = makeStore();
    await store.load({ refresh: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, URL_UNDER_TEST);
    assert.equal(calls[0].method, 'GET');
  });

  it('keeps a copy in storage and paints it instantly on the next visit', async () => {
    const storage = memoryStorage();
    await makeStore({ storage }).store.load();
    const cached = storage.get(CACHE_KEY, null);
    assert.equal(cached.entries.length, 2);

    const { store: second } = makeStore({ storage, failing: true });
    const states = [];
    second.subscribe((state) => states.push({ status: state.status, fromCache: state.fromCache }));

    await second.load();
    assert.deepEqual(states[0], { status: 'ready', fromCache: true });
    assert.equal(second.getCollection().size, 2);
    // The refresh failed, so the cached copy stays on screen (and stays flagged).
    assert.equal(second.getState().fromCache, true);
    assert.equal(second.getState().status, 'ready');
    assert.match(second.getState().error, /Could not read/);
  });

  it('skips malformed entries but reports them', async () => {
    const { store } = makeStore({
      bundle: { entries: [{ id: 'ok', name: 'OK' }, { name: '' }, { id: 'x' }] },
    });
    await store.load();
    assert.equal(store.getCollection().size, 1);
    assert.equal(store.getState().issues.length, 2);
  });

  it('reports a missing file with an actionable message', async () => {
    const { store } = makeStore({ status: 404, bundle: {} });
    await store.load();
    assert.equal(store.getState().status, 'error');
    assert.equal(store.getState().errorKind, 'missing');
    assert.match(store.getState().error, /404/);
    assert.match(store.getState().error, /not found/i);
  });

  it('reports invalid JSON', async () => {
    const storage = memoryStorage();
    const fetchImpl = /** @type {any} */ (async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '{oops',
      }));
    const store = createEntriesStore({ url: URL_UNDER_TEST, storage, fetchImpl });
    await store.load();
    assert.equal(store.getState().errorKind, 'format');
    assert.match(store.getState().error, /not valid JSON/);
  });

  it('reports a network failure', async () => {
    const { store } = makeStore({ failing: true });
    await store.load();
    assert.equal(store.getState().status, 'error');
    assert.equal(store.getState().errorKind, 'network');
  });

  it('ignores a slow load that a newer one has superseded', async () => {
    const storage = memoryStorage();
    let calls = 0;
    const fetchImpl = /** @type {any} */ (async () => {
      calls += 1;
      const slow = calls === 1;
      const body = slow
        ? JSON.stringify({ entries: [{ id: 'old', name: 'Old' }] })
        : JSON.stringify(BUNDLE);
      if (slow) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return /** @type {Response} */ ({ ok: true, status: 200, text: async () => body });
    });
    const store = createEntriesStore({ url: URL_UNDER_TEST, storage, fetchImpl });

    const slow = store.load();
    const fast = store.load();
    await Promise.all([slow, fast]);
    assert.equal(store.getCollection().size, 2);
    assert.equal(store.getCollection().byId('entropy').name, '熵');
    assert.equal(store.getState().stale, false);
  });
});