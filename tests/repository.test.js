import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_CONFIG } from '../web/js/config.js';
import { ConflictError, DataSourceError } from '../web/js/core/errors.js';
import { EntryRepository } from '../web/js/data/repository.js';
import { createSnapshot, revisionOf } from '../web/js/data/source.js';
import { EntryCollection } from '../web/js/core/collection.js';
import { memoryStorage } from './helpers/index.js';

/**
 * A data source whose behaviour each test can control.
 */
class FakeSource {
  /**
   * @param {{entries?: object[], writable?: boolean, failLoad?: Error|null, failWrite?: Error|null}} [options]
   */
  constructor(options = {}) {
    this.id = 'fake';
    this.label = '测试数据源';
    this.writable = options.writable ?? true;
    this.description = 'in-memory';
    this.entries = options.entries ?? [{ id: 'a', name: 'Alpha' }];
    this.failLoad = options.failLoad ?? null;
    this.failWrite = options.failWrite ?? null;
    this.loadCount = 0;
    /** @type {string[]} */
    this.writes = [];
    this.delayMs = 0;
    /** @type {number[]} Per-call delays for `load`, consumed in order. */
    this.loadDelays = [];
  }

  /** @returns {import('../web/js/data/source.js').SourceSnapshot} */
  snapshot() {
    const collection = EntryCollection.fromEntries(this.entries.map((entry) => ({ ...entry })));
    return createSnapshot(collection, { revision: revisionOf(this.entries), origin: 'fake' });
  }

  async load() {
    this.loadCount += 1;
    // The snapshot is taken before any artificial delay, so a slow response
    // really does carry older data.
    const snapshot = this.snapshot();
    const delayMs = this.loadDelays.shift() ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (this.failLoad) {
      throw this.failLoad;
    }
    return snapshot;
  }

  /**
   * @param {string} kind
   * @returns {Promise<void>}
   */
  async tick(kind) {
    this.writes.push(kind);
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failWrite) {
      throw this.failWrite;
    }
  }

  async createEntry(entry) {
    await this.tick('create');
    this.entries = [...this.entries, entry];
    return this.snapshot();
  }

  async updateEntry(entry) {
    await this.tick('update');
    this.entries = this.entries.map((item) => (item.id === entry.id ? entry : item));
    return this.snapshot();
  }

  async deleteEntry(id) {
    await this.tick('delete');
    this.entries = this.entries.filter((item) => item.id !== id);
    return this.snapshot();
  }
}

/**
 * @param {FakeSource} source
 * @param {{storage?: any}} [options]
 * @returns {EntryRepository}
 */
function makeRepository(source, options = {}) {
  return new EntryRepository({
    config: structuredClone(DEFAULT_CONFIG),
    storage: options.storage ?? memoryStorage(),
    source,
  });
}

describe('EntryRepository - loading', () => {
  it('starts empty, then reports the loaded snapshot', async () => {
    const source = new FakeSource();
    const repository = makeRepository(source);
    const seen = [];
    repository.subscribe((state) => seen.push({ status: state.status, size: state.collection.size }));

    await repository.init();
    assert.equal(repository.state.status, 'ready');
    assert.equal(repository.state.collection.size, 1);
    assert.equal(repository.state.writable, true);
    assert.equal(repository.state.origin, 'fake');
    assert.equal(source.loadCount, 1);
    assert.deepEqual(seen[0], { status: 'loading', size: 0 });
  });

  it('paints from the cache before the network answers', async () => {
    const storage = memoryStorage();
    const first = makeRepository(new FakeSource(), { storage });
    await first.init();

    const offline = new FakeSource({ failLoad: new DataSourceError('离线', { kind: 'network' }) });
    const second = makeRepository(offline, { storage });
    const states = [];
    second.subscribe((state) => states.push({ status: state.status, stale: state.stale }));

    await second.init();
    assert.equal(states[0].status, 'ready');
    assert.equal(states[0].stale, true);
    assert.equal(second.state.collection.size, 1);
    assert.match(second.state.error, /离线/);
    assert.equal(second.state.errorKind, 'network');
  });

  it('reports an error state when there is nothing cached', async () => {
    const source = new FakeSource({ failLoad: new DataSourceError('挂了', { kind: 'network' }) });
    const repository = makeRepository(source);
    await repository.init();
    assert.equal(repository.state.status, 'error');
    assert.equal(repository.state.error, '挂了');
    assert.equal(repository.state.stale, false);
  });

  it('ignores a slow refresh that a newer one has already superseded', async () => {
    const source = new FakeSource();
    source.loadDelays = [30, 0];
    const repository = makeRepository(source);
    await repository.init();

    const slow = repository.refresh(); // captures the 1-entry snapshot, answers last
    source.entries = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ];
    const fast = repository.refresh(); // 2 entries, answers first
    await Promise.all([slow, fast]);

    assert.equal(repository.state.collection.size, 2);
    assert.equal(repository.state.stale, false);
    assert.equal(repository.state.status, 'ready');
  });
});

describe('EntryRepository - writes', () => {
  it('applies a create optimistically and caches the result', async () => {
    const source = new FakeSource();
    const storage = memoryStorage();
    const repository = makeRepository(source, { storage });
    await repository.init();

    const entry = { id: 'b', name: 'Beta', aliases: [], tags: [], summary: '', content: '' };
    const { created } = await repository.saveEntry(entry);
    assert.equal(created, true);
    assert.equal(repository.state.collection.size, 2);
    assert.deepEqual(source.writes, ['create']);
    assert.equal(storage.get('cache.fake.v1', null).entries.length, 2);
  });

  it('detects an update by id', async () => {
    const source = new FakeSource();
    const repository = makeRepository(source);
    await repository.init();
    const { created } = await repository.saveEntry({ id: 'a', name: 'Alpha 2' });
    assert.equal(created, false);
    assert.deepEqual(source.writes, ['update']);
    assert.equal(repository.state.collection.byId('a').name, 'Alpha 2');
  });

  it('rolls back and reports a failed write', async () => {
    const source = new FakeSource({ failWrite: new DataSourceError('写失败', { kind: 'http' }) });
    const repository = makeRepository(source);
    await repository.init();

    await assert.rejects(
      () => repository.saveEntry({ id: 'b', name: 'Beta' }),
      /写失败/,
    );
    assert.equal(repository.state.collection.size, 1);
    assert.equal(repository.state.collection.byId('b'), null);
    assert.equal(repository.state.pending, false);
    assert.match(repository.state.error, /写失败/);
  });

  it('marks conflicts distinctly', async () => {
    const source = new FakeSource({ failWrite: new ConflictError('被别人改过') });
    const repository = makeRepository(source);
    await repository.init();
    await assert.rejects(() => repository.saveEntry({ id: 'b', name: 'Beta' }), ConflictError);
    assert.equal(repository.state.errorKind, 'conflict');
  });

  it('deletes and rolls back on failure', async () => {
    const source = new FakeSource();
    const repository = makeRepository(source);
    await repository.init();
    await repository.deleteEntry('a');
    assert.equal(repository.state.collection.size, 0);
    assert.deepEqual(source.writes, ['delete']);

    const failing = new FakeSource({ failWrite: new DataSourceError('拒绝删除') });
    const second = makeRepository(failing);
    await second.init();
    await assert.rejects(() => second.deleteEntry('a'));
    assert.equal(second.state.collection.size, 1);
  });

  it('serializes concurrent writes', async () => {
    const source = new FakeSource();
    source.delayMs = 5;
    const repository = makeRepository(source);
    await repository.init();

    await Promise.all([
      repository.saveEntry({ id: 'b', name: 'Beta' }),
      repository.saveEntry({ id: 'c', name: 'Gamma' }),
    ]);
    assert.deepEqual(source.writes, ['create', 'create']);
    assert.equal(repository.state.collection.size, 3);
  });
});

describe('EntryRepository - sources', () => {
  it('switches to the local source and keeps its data', async () => {
    const storage = memoryStorage();
    const repository = makeRepository(new FakeSource(), { storage });
    await repository.init();

    await repository.setConfig({ source: 'local' });
    assert.equal(repository.state.sourceId, 'local');
    assert.equal(repository.state.collection.size, 0);

    await repository.saveEntry({ id: 'x', name: 'X' });
    assert.equal(repository.state.collection.size, 1);

    // Reloading the local source reads the same persisted document.
    await repository.refresh();
    assert.equal(repository.state.collection.byId('x').name, 'X');
  });

  it('imports a document into the local source and rejects it elsewhere', async () => {
    const storage = memoryStorage();
    const repository = makeRepository(new FakeSource(), { storage });
    await repository.init();
    await assert.rejects(() => repository.importDocument({ entries: [] }), /不支持整体导入/);

    await repository.setConfig({ source: 'local' });
    const state = await repository.importDocument({
      entries: [{ id: 'z', name: 'Zeta' }],
    });
    assert.equal(state.collection.size, 1);
  });

  it('exports the current collection as a document', async () => {
    const repository = makeRepository(new FakeSource());
    await repository.init();
    const document = repository.exportDocument();
    assert.equal(document.version, 1);
    assert.equal(document.entries[0].id, 'a');
  });
});