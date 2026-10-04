import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStorage } from '../web/js/util/storage.js';
import { memoryStorage } from './helpers/index.js';

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

  it('keeps namespaces apart', () => {
    const base = memoryStorage();
    const other = createStorage('other', { memoryOnly: true });
    base.set('k', 'a');
    other.set('k', 'b');
    assert.equal(base.get('k', ''), 'a');
    assert.equal(other.get('k', ''), 'b');
  });
});