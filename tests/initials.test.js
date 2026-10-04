import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INITIALS,
  OTHER_INITIAL,
  initialOfEntry,
  initialOfName,
  initialRank,
  isInitial,
} from '../web/js/core/initials.js';
import { compareEntries, groupEntriesByInitial, sortEntries } from '../web/js/core/sort.js';

describe('initialOfName', () => {
  it('uses the first letter of Latin names', () => {
    assert.equal(initialOfName('Binary Search'), 'B');
    assert.equal(initialOfName('entropy'), 'E');
  });

  it('skips punctuation, brackets and whitespace', () => {
    assert.equal(initialOfName('《存在与时间》'), 'C');
    assert.equal(initialOfName('  -alpha'), 'A');
    assert.equal(initialOfName('"quoted"'), 'Q');
  });

  it('folds diacritics and full-width letters', () => {
    assert.equal(initialOfName('Émile'), 'E');
    assert.equal(initialOfName('Ｇraph'), 'G');
  });

  it('uses the pinyin initial for Chinese names', () => {
    assert.equal(initialOfName('熵'), 'S');
    assert.equal(initialOfName('二分查找'), 'E');
    assert.equal(initialOfName('复利'), 'F');
    assert.equal(initialOfName('康威定律'), 'K');
    assert.equal(initialOfName('涌现'), 'Y');
    assert.equal(initialOfName('邓宁-克鲁格效应'), 'D');
  });

  it('uses the most common reading of a single character', () => {
    // A single code point carries no word context, so 重 resolves to its
    // default reading zhòng. That limitation is exactly why an entry can
    // override the bucket with the "首字母" field.
    assert.equal(initialOfName('重庆'), 'Z');
    assert.equal(initialOfEntry({ name: '重庆', initial: 'C' }), 'C');
    assert.equal(initialOfName('重要'), 'Z');
  });

  it('puts digits and unknown scripts in the "#" bucket', () => {
    assert.equal(initialOfName('5W1H'), OTHER_INITIAL);
    assert.equal(initialOfName('123'), OTHER_INITIAL);
    assert.equal(initialOfName(''), OTHER_INITIAL);
    // Emoji and other symbols are skipped like punctuation.
    assert.equal(initialOfName('🙂 smile'), 'S');
    assert.equal(initialOfName('🙂'), OTHER_INITIAL);
  });

  it('covers traditional characters as well', () => {
    assert.equal(initialOfName('資訊'), 'Z');
  });
});

describe('initialOfEntry', () => {
  it('honours an explicit override', () => {
    assert.equal(initialOfEntry({ name: '涌现', initial: 'A' }), 'A');
    assert.equal(initialOfEntry({ name: '涌现', initial: '#' }), '#');
  });

  it('ignores an invalid override', () => {
    assert.equal(initialOfEntry({ name: '涌现', initial: '9' }), 'Y');
  });

  it('exposes the bucket list', () => {
    assert.equal(INITIALS.length, 27);
    assert.ok(isInitial('A'));
    assert.ok(isInitial('#'));
    assert.ok(!isInitial('a'));
    assert.equal(initialRank('#') > initialRank('Z'), true);
  });
});

describe('sorting and grouping', () => {
  const entries = [
    { id: '1', name: '熵' },
    { id: '2', name: 'Binary Search' },
    { id: '3', name: '复利' },
    { id: '4', name: '5W1H' },
    { id: '5', name: '二分查找' },
    { id: '6', name: '奥卡姆剃刀' },
  ];

  it('sorts by bucket then name', () => {
    assert.deepEqual(
      sortEntries(entries).map((entry) => entry.name),
      ['奥卡姆剃刀', 'Binary Search', '二分查找', '复利', '熵', '5W1H'],
    );
  });

  it('groups without empty buckets and keeps "#" last', () => {
    const groups = groupEntriesByInitial(entries);
    assert.deepEqual(
      groups.map((group) => [group.letter, group.entries.length]),
      [
        ['A', 1],
        ['B', 1],
        ['E', 1],
        ['F', 1],
        ['S', 1],
        ['#', 1],
      ],
    );
  });

  it('is a stable total order (ties broken by id)', () => {
    const tied = [
      { id: 'b', name: 'Same' },
      { id: 'a', name: 'Same' },
    ];
    assert.deepEqual(
      sortEntries(tied).map((entry) => entry.id),
      ['a', 'b'],
    );
  });

  it('does not mutate the input array', () => {
    const input = [...entries];
    sortEntries(input);
    assert.deepEqual(input.map((entry) => entry.id), entries.map((entry) => entry.id));
  });

  it('compareEntries agrees with sortEntries', () => {
    const sorted = sortEntries(entries);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(compareEntries(sorted[index - 1], sorted[index]) < 0);
    }
  });
});