import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ConflictError, ValidationError } from '../web/js/core/errors.js';
import { EntryStore } from '../server/lib/store.js';
import { makeTempDir, removeTempDir } from './helpers/index.js';

describe('EntryStore', () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let file;
  /** @type {EntryStore} */
  let store;

  before(async () => {
    dir = await makeTempDir('store');
    file = path.join(dir, 'entries.json');
    store = new EntryStore({ file });
    await store.ensureFile();
  });

  after(async () => {
    await removeTempDir(dir);
  });

  it('creates an empty bundle when the file is missing', async () => {
    const document = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(document.entries, []);
    assert.equal(document.version, 1);
  });

  it('creates an entry, writes atomically and reports a revision', async () => {
    const before = await store.snapshot();
    const result = await store.createEntry({ id: 'alpha', name: 'Alpha', tags: ['x'] });
    assert.equal(result.created.name, 'Alpha');
    assert.equal(result.entries.length, 1);
    assert.notEqual(result.revision, before.revision);

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(onDisk.entries[0].name, 'Alpha');
    assert.equal(onDisk.entries[0].updatedAt.length > 0, true);

    const leftovers = (await fs.readdir(dir)).filter((name) => name.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
  });

  it('keeps a backup of the previous content', async () => {
    await store.createEntry({ id: 'beta', name: 'Beta' });
    const backup = JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'));
    assert.equal(backup.entries.length, 1);
  });

  it('rejects invalid and duplicate entries', async () => {
    await assert.rejects(() => store.createEntry({ name: '' }), ValidationError);
    await assert.rejects(() => store.createEntry({ id: 'alpha', name: 'Alpha' }), ValidationError);
    await assert.rejects(
      () => store.createEntry({ id: 'gamma', name: 'Beta' }),
      (error) => {
        assert.match(error.describe(), /已存在/);
        return true;
      },
    );
  });

  it('updates an entry, preserving createdAt', async () => {
    const created = (await store.snapshot()).entries.find((entry) => entry.id === 'alpha');
    const result = await store.updateEntry('alpha', { name: 'Alpha 2', content: 'body' });
    assert.equal(result.updated.name, 'Alpha 2');
    assert.equal(result.updated.createdAt, created.createdAt);
    assert.equal(result.updated.content, 'body');
  });

  it('returns null for an unknown id instead of failing', async () => {
    const result = await store.updateEntry('nope', { name: 'Nope' });
    assert.equal(result.updated, null);
    const removed = await store.deleteEntry('nope');
    assert.equal(removed.removed, null);
  });

  it('deletes an entry', async () => {
    const result = await store.deleteEntry('beta');
    assert.equal(result.removed.name, 'Beta');
    assert.equal(result.entries.some((entry) => entry.id === 'beta'), false);
  });

  it('enforces If-Match revisions', async () => {
    const snapshot = await store.snapshot();
    await assert.rejects(
      () => store.createEntry({ id: 'delta', name: 'Delta' }, { ifMatch: 'stale-revision' }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.actual, snapshot.revision);
        return true;
      },
    );
    const ok = await store.createEntry(
      { id: 'delta', name: 'Delta' },
      { ifMatch: snapshot.revision },
    );
    assert.equal(ok.created.id, 'delta');
  });

  it('serializes concurrent writes without losing any', async () => {
    await Promise.all([
      store.createEntry({ id: 'e1', name: 'E1' }),
      store.createEntry({ id: 'e2', name: 'E2' }),
      store.createEntry({ id: 'e3', name: 'E3' }),
    ]);
    const final = await store.snapshot();
    for (const id of ['e1', 'e2', 'e3']) {
      assert.ok(
        final.entries.some((entry) => entry.id === id),
        `${id} missing after concurrent writes`,
      );
    }
  });

  it('validates the file on read and refuses malformed JSON', async () => {
    const broken = path.join(dir, 'broken.json');
    await fs.writeFile(broken, '{not json');
    const brokenStore = new EntryStore({ file: broken });
    await assert.rejects(() => brokenStore.snapshot(), /不是合法 JSON/);
  });

  it('reports stats and parsing issues', async () => {
    const withIssues = path.join(dir, 'issues.json');
    await fs.writeFile(
      withIssues,
      JSON.stringify({ version: 1, entries: [{ id: 'ok', name: 'OK' }, { name: '' }] }),
    );
    const stats = await new EntryStore({ file: withIssues }).stats();
    assert.equal(stats.entries, 1);
    assert.equal(stats.issues, 1);
  });

  it('replaces the whole document in strict mode', async () => {
    const target = path.join(dir, 'replace.json');
    const replacement = new EntryStore({ file: target });
    await replacement.ensureFile();
    const result = await replacement.replaceDocument({
      entries: [{ id: 'only', name: 'Only' }],
    });
    assert.equal(result.entries.length, 1);
    await assert.rejects(() => replacement.replaceDocument({ entries: [{ name: '' }] }), ValidationError);
  });
});