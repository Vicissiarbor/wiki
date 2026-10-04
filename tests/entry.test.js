import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIMITS,
  applyEntryPatch,
  assertValidEntry,
  buildEntryId,
  cleanLine,
  cleanText,
  createEntry,
  inspectEntry,
  isValidTimestamp,
  normalizeEntry,
  shortHash,
} from '../web/js/core/entry.js';
import { ValidationError } from '../web/js/core/errors.js';

describe('normalizeEntry', () => {
  it('trims, normalizes width and drops unknown keys', () => {
    const entry = normalizeEntry({
      id: '  x  ',
      name: '  熵  ',
      aliases: [' entropy ', 'entropy', ''],
      tags: 'solo',
      summary: '  a  b  ',
      extra: 'ignored',
    });
    assert.deepEqual(entry, {
      id: 'x',
      name: '熵',
      nameZh: '',
      aliases: ['entropy'],
      aliasesZh: [],
      initial: '',
      initialZh: '',
      tags: ['solo'],
      tagsZh: [],
      summary: 'a b',
      summaryZh: '',
      content: '',
      contentZh: '',
      createdAt: '',
      updatedAt: '',
    });
  });

  it('strips control characters but keeps newlines in content', () => {
    assert.equal(cleanText('a\u0000b\nc'), 'ab\nc');
    assert.equal(cleanText('line1\r\nline2'), 'line1\nline2');
    assert.equal(cleanLine('a\n\nb'), 'a b');
  });

  it('rejects non-objects and missing names', () => {
    assert.throws(() => normalizeEntry(null), ValidationError);
    assert.throws(() => normalizeEntry([]), ValidationError);
    assert.throws(() => normalizeEntry({ name: '   ' }), ValidationError);
  });

  it('uppercases and validates the initial override', () => {
    assert.equal(normalizeEntry({ name: 'x', initial: 'y' }).initial, 'Y');
    assert.throws(() => normalizeEntry({ name: 'x', initial: 'ab' }), ValidationError);
    assert.throws(() => normalizeEntry({ name: 'x', initial: '中' }), ValidationError);
  });
});

describe('inspectEntry', () => {
  it('accepts a normal entry and reports a missing id', () => {
    const { issues } = inspectEntry({ name: 'Alpha' });
    assert.deepEqual(
      issues.map((issue) => issue.code),
      ['missing'],
    );
  });

  it('reports duplicate names and ids', () => {
    const siblings = [{ id: 'a', name: 'Alpha', aliases: [] }];
    const { issues } = inspectEntry({ id: 'a', name: 'alpha' }, { siblings });
    const codes = issues.map((issue) => issue.code).sort();
    assert.deepEqual(codes, ['duplicate', 'duplicate']);
  });

  it('flags aliases that shadow another entry name', () => {
    const siblings = [{ id: 'a', name: 'Alpha', aliases: [] }];
    const { issues } = inspectEntry({ id: 'b', name: 'Beta', aliases: ['alpha'] }, { siblings });
    assert.equal(issues[0].code, 'shadowed');
  });

  it('enforces field limits', () => {
    const { issues } = inspectEntry({
      id: 'a',
      name: 'x'.repeat(LIMITS.NAME + 1),
      summary: 'y'.repeat(LIMITS.SUMMARY + 1),
    });
    const fields = issues.map((issue) => issue.field);
    assert.ok(fields.includes('name'));
    assert.ok(fields.includes('summary'));
  });

  it('rejects a bad id format', () => {
    const { issues } = inspectEntry({ id: 'has space', name: 'x' });
    assert.equal(issues[0].code, 'format');
  });

  it('assertValidEntry throws with issues attached', () => {
    try {
      assertValidEntry({ name: 'Alpha', id: 'a' }, { siblings: [{ id: 'a', name: 'Alpha' }] });
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.issues.length > 0);
      assert.match(error.describe(), /词条数据不合法/);
    }
  });
});

describe('timestamps', () => {
  it('accepts a day-precision date', () => {
    assert.equal(isValidTimestamp('2026-10-04'), true);
    const { issues } = inspectEntry({ id: 'a', name: 'A', updatedAt: '2026-10-04' });
    assert.deepEqual(issues, []);
  });

  it('still accepts full ISO-8601 timestamps', () => {
    assert.equal(isValidTimestamp('2026-10-04T11:28:00.000Z'), true);
    const { issues } = inspectEntry({ id: 'a', name: 'A', createdAt: '2026-10-04T11:28:00.000Z' });
    assert.deepEqual(issues, []);
  });

  it('accepts an empty timestamp', () => {
    assert.equal(isValidTimestamp(''), true);
    assert.deepEqual(inspectEntry({ id: 'a', name: 'A' }).issues, []);
  });

  it('rejects nonsense and impossible dates', () => {
    for (const value of ['昨天', '2026/10/04', '2026-13-01', '20261004']) {
      assert.equal(isValidTimestamp(value), false, value);
      const { issues } = inspectEntry({ id: 'a', name: 'A', updatedAt: value });
      assert.equal(issues.length, 1, value);
      assert.equal(issues[0].field, 'updatedAt');
      assert.equal(issues[0].code, 'format');
    }
  });

  it('keeps a day-precision date as written when patching an entry', () => {
    const created = createEntry({ name: 'Alpha' }, { now: new Date('2026-01-01T00:00:00.000Z') });
    const patched = applyEntryPatch(created, { updatedAt: '2026-10-04' });
    assert.equal(patched.updatedAt, '2026-10-04');
  });
});

describe('createEntry / applyEntryPatch', () => {
  it('generates a slug id and timestamps', () => {
    const now = new Date('2025-03-03T03:03:03.000Z');
    const entry = createEntry({ name: 'Binary Search' }, { now });
    assert.equal(entry.id, 'binary-search');
    assert.equal(entry.createdAt, now.toISOString());
    assert.equal(entry.updatedAt, now.toISOString());
  });

  it('generates a deterministic id for non-ASCII names', () => {
    const first = createEntry({ name: '熵' });
    const second = createEntry({ name: '熵' });
    assert.equal(first.id, second.id);
    assert.match(first.id, /^term-[a-z0-9]+$/);
  });

  it('avoids id collisions', () => {
    const taken = new Set(['binary-search']);
    assert.equal(buildEntryId('binary search', { taken }), 'binary-search-2');
  });

  it('applies a patch and keeps createdAt', () => {
    const created = createEntry({ name: 'Alpha' }, { now: new Date('2025-01-01T00:00:00.000Z') });
    const updated = applyEntryPatch(
      created,
      { summary: 'new' },
      { now: new Date('2025-02-02T00:00:00.000Z') },
    );
    assert.equal(updated.summary, 'new');
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.updatedAt, '2025-02-02T00:00:00.000Z');
    assert.equal(updated.id, created.id);
  });

  it('shortHash is stable', () => {
    assert.equal(shortHash('熵'), shortHash('熵'));
    assert.notEqual(shortHash('熵'), shortHash('热'));
  });
});