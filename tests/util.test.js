import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStorage } from '../web/js/util/storage.js';
import { debounce, delay } from '../web/js/util/timing.js';

describe('debounce', () => {
  it('runs once after the quiet period with the latest arguments', async () => {
    /** @type {string[]} */
    const seen = [];
    const fn = debounce((value) => seen.push(value), 15);
    fn('a');
    fn('b');
    fn('c');
    assert.deepEqual(seen, []);
    await delay(40);
    assert.deepEqual(seen, ['c']);
  });

  it('fires at least once during a long burst (maxWaitMs)', async () => {
    let calls = 0;
    const fn = debounce(() => (calls += 1), 30, { maxWaitMs: 20 });
    const timer = setInterval(() => fn(), 5);
    await delay(90);
    clearInterval(timer);
    fn.cancel();
    assert.ok(calls >= 2, `expected at least 2 calls, got ${calls}`);
  });

  it('cancel drops a pending call and flush runs it', async () => {
    let calls = 0;
    const fn = debounce(() => (calls += 1), 20);
    fn();
    assert.equal(fn.pending(), true);
    fn.cancel();
    await delay(35);
    assert.equal(calls, 0);
    fn();
    fn.flush();
    assert.equal(calls, 1);
  });

  it('passes every argument through', async () => {
    /** @type {unknown[][]} */
    const seen = [];
    const fn = debounce((...args) => seen.push(args), 5);
    fn(1, 'two', { three: true });
    await delay(20);
    assert.deepEqual(seen, [[1, 'two', { three: true }]]);
  });
});

describe('createStorage', () => {
  it('round-trips JSON values', () => {
    const storage = createStorage('t1', { memoryOnly: true });
    assert.equal(storage.available, false);
    assert.equal(storage.get('missing', 'fallback'), 'fallback');
    storage.set('key', { a: [1, 2], b: 'x' });
    assert.deepEqual(storage.get('key', null), { a: [1, 2], b: 'x' });
    assert.deepEqual(storage.keys(), ['t1.key']);
    storage.remove('key');
    assert.equal(storage.get('key', null), null);
  });

  it('survives corrupted data', () => {
    /** @type {Map<string, string>} */
    const backing = new Map();
    const backend = /** @type {Storage} */ ({
      getItem: (key) => backing.get(key) ?? null,
      setItem: (key, value) => backing.set(key, value),
      removeItem: (key) => backing.delete(key),
    });
    const storage = createStorage('t2', { backend });
    backing.set('t2.broken', '{not json');
    assert.equal(storage.get('broken', 'fallback'), 'fallback');
    assert.equal(storage.available, true);
    storage.set('ok', 1);
    assert.equal(storage.get('ok', 0), 1);
    storage.clear();
    assert.deepEqual(storage.keys(), []);
  });

  it('falls back to memory when the backend throws', () => {
    const backend = /** @type {Storage} */ ({
      getItem() {
        throw new Error('quota');
      },
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('quota');
      },
    });
    const storage = createStorage('t3', { backend });
    assert.equal(storage.set('key', 1), false);
    assert.equal(storage.get('key', 0), 1);
  });
});