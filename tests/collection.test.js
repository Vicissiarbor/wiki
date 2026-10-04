import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EntryCollection, readEntriesDocument } from '../web/js/core/collection.js';
import { ValidationError } from '../web/js/core/errors.js';

const sample = () => ({
  version: 1,
  updatedAt: '2025-01-01T00:00:00.000Z',
  entries: [
    { id: 'a', name: 'Alpha', aliases: ['A'], tags: ['t'], summary: 's', content: 'c' },
    { id: 'b', name: 'Beta' },
  ],
});

describe('readEntriesDocument', () => {
  it('reads a bundle', () => {
    const { entries, version, updatedAt, issues } = readEntriesDocument(sample());
    assert.equal(entries.length, 2);
    assert.equal(version, 1);
    assert.equal(updatedAt, '2025-01-01T00:00:00.000Z');
    assert.deepEqual(issues, []);
  });

  it('accepts a bare array', () => {
    const { entries } = readEntriesDocument([{ id: 'x', name: 'X' }]);
    assert.equal(entries.length, 1);
  });

  it('skips broken entries but reports them (lenient mode)', () => {
    const { entries, issues } = readEntriesDocument({
      entries: [{ id: 'ok', name: 'OK' }, { name: '' }, { id: 'no-name' }, 42],
    });
    assert.equal(entries.length, 1);
    assert.equal(issues.length, 3);
    assert.match(issues[0].message, /name|无法解析/);
  });

  it('skips duplicate ids and entries without an id', () => {
    const { entries, issues } = readEntriesDocument({
      entries: [
        { id: 'dup', name: 'One' },
        { id: 'dup', name: 'Two' },
        { name: 'No id' },
      ],
    });
    assert.equal(entries.length, 1);
    assert.equal(issues.length, 2);
    assert.match(issues[0].message, /重复/);
  });

  it('throws in strict mode', () => {
    assert.throws(
      () => readEntriesDocument({ entries: [{ name: '' }] }, { strict: true }),
      ValidationError,
    );
    assert.throws(() => readEntriesDocument({ entries: 'nope' }), ValidationError);
    assert.throws(() => readEntriesDocument(null), ValidationError);
  });
});

describe('EntryCollection', () => {
  it('indexes by id and by name (case-insensitive)', () => {
    const { collection } = EntryCollection.fromDocument(sample());
    assert.equal(collection.size, 2);
    assert.equal(collection.byId('a').name, 'Alpha');
    assert.equal(collection.byName('alpha').id, 'a');
    assert.equal(collection.byName('BETA').id, 'b');
    assert.equal(collection.byId('missing'), null);
  });

  it('finds entries through aliases', () => {
    const { collection } = EntryCollection.fromDocument(sample());
    assert.equal(collection.byName('A').id, 'a');
  });

  it('is immutable: withEntry/withoutEntry return new collections', () => {
    const { collection } = EntryCollection.fromDocument(sample());
    const added = collection.withEntry({ id: 'c', name: 'Gamma' });
    assert.equal(collection.size, 2);
    assert.equal(added.size, 3);
    const removed = added.withoutEntry('c');
    assert.equal(removed.size, 2);
    assert.equal(collection.withoutEntry('nope'), collection);
  });

  it('rejects duplicate names', () => {
    const { collection } = EntryCollection.fromDocument(sample());
    assert.throws(() => collection.withEntry({ id: 'c', name: 'alpha' }), ValidationError);
  });

  it('rejects an entry without id', () => {
    const { collection } = EntryCollection.fromDocument(sample());
    assert.throws(() => collection.withEntry({ name: 'No id' }), ValidationError);
  });

  it('toDocument drops empty fields and keeps key order', () => {
    const { collection } = EntryCollection.fromDocument(sample());
    const document = collection.toDocument({ updatedAt: '2025-02-02T00:00:00.000Z' });
    assert.deepEqual(Object.keys(document.entries[1]), ['id', 'name']);
    assert.equal(document.updatedAt, '2025-02-02T00:00:00.000Z');
    assert.equal(document.version, 1);
  });

  it('derives the latest update from the entries, not from a hand-maintained field', () => {
    const { collection } = EntryCollection.fromDocument({
      version: 1,
      updatedAt: '2020-01-01',
      entries: [
        { id: 'a', name: 'A', updatedAt: '2026-10-04' },
        { id: 'b', name: 'B', createdAt: '2026-09-01T08:00:00.000Z' },
        { id: 'c', name: 'C', updatedAt: '2025-12-31' },
      ],
    });
    assert.equal(collection.latestUpdatedAt(), '2026-10-04');
  });

  it('prefers updatedAt over createdAt and copes with missing dates', () => {
    const { collection } = EntryCollection.fromDocument({
      entries: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B', createdAt: '2026-01-02', updatedAt: '2025-01-01' },
      ],
    });
    // '2026-01-02' (createdAt) wins over the older updatedAt of that entry.
    assert.equal(collection.latestUpdatedAt(), '2026-01-02');
  });

  it('returns an empty string when no entry carries a date', () => {
    const { collection } = EntryCollection.fromDocument({ entries: [{ id: 'a', name: 'A' }] });
    assert.equal(collection.latestUpdatedAt(), '');
  });

  it('hands out frozen entries so views cannot corrupt the snapshot', () => {
    const { collection } = EntryCollection.fromDocument(sample());
    const entry = collection.byId('a');
    assert.ok(Object.isFrozen(entry));
    assert.throws(() => {
      entry.name = 'mutated';
    }, TypeError);
    assert.equal(collection.byId('a').name, 'Alpha');
  });
});