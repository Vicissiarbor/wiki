import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_QUERY_LENGTH,
  SearchMode,
  assessRegexRisk,
  describeQuery,
  fieldsForQuery,
  findMatches,
  matchEntry,
  normalizeForMatch,
  parseQuery,
  searchEntries,
  splitByMatches,
} from '../web/js/core/search.js';

/** A small fixture covering every field. */
const entries = [
  {
    id: 'entropy',
    name: '熵',
    aliases: ['entropy', '信息熵'],
    tags: ['物理', '信息论'],
    summary: '度量不确定性',
    content: 'H(X) = -Σ p log p',
  },
  {
    id: 'enthalpy',
    name: '焓',
    aliases: ['enthalpy'],
    tags: ['物理'],
    summary: '热力学状态函数',
    content: 'H = U + pV',
  },
  {
    id: 'regex',
    name: '正则表达式',
    aliases: ['regular expression', 'regex'],
    tags: ['文本处理'],
    summary: '描述字符串集合',
    content: 'a+ 表示一个或多个 a',
  },
];

describe('parseQuery', () => {
  it('treats an empty query as browse mode', () => {
    const parsed = parseQuery('   ');
    assert.equal(parsed.isEmpty, true);
    assert.equal(parsed.error, '');
  });

  it('detects exact mode with a leading "="', () => {
    const parsed = parseQuery('=熵');
    assert.equal(parsed.mode, SearchMode.EXACT);
    assert.equal(parsed.term, '熵');
  });

  it('detects regex literals with flags', () => {
    const parsed = parseQuery('/^ent/i');
    assert.equal(parsed.mode, SearchMode.REGEX);
    assert.equal(parsed.term, '^ent');
    assert.equal(parsed.regex.flags, 'i');
  });

  it('uses the mode chosen in the UI when no marker is present', () => {
    assert.equal(parseQuery('熵', { mode: SearchMode.EXACT }).mode, SearchMode.EXACT);
    const parsed = parseQuery('^熵');
    assert.equal(parsed.mode, SearchMode.CONTAINS);
  });

  it('strips surrounding quotes in exact mode', () => {
    assert.equal(parseQuery('="信息 熵"').term, '信息 熵');
    assert.equal(parseQuery('="x"').term, 'x');
  });

  it('parses field scopes, including aliases of the field names', () => {
    assert.equal(parseQuery('tag:物理').scope, 'tags');
    assert.equal(parseQuery('tags:物理').term, '物理');
    assert.equal(parseQuery('content:/H\\(X\\)/').scope, 'content');
    assert.equal(parseQuery('content:/H\\(X\\)/').mode, SearchMode.REGEX);
    assert.equal(parseQuery('text:something').scope, 'text');
    assert.equal(parseQuery('unknown:x').scope, '');
  });

  it('reports an empty scope instead of silently matching everything', () => {
    const parsed = parseQuery('tag:');
    assert.notEqual(parsed.error, '');
    assert.equal(parsed.isEmpty, false);
  });

  it('reports invalid regex instead of throwing', () => {
    const parsed = parseQuery('/[/');
    assert.match(parsed.error, /正则表达式无效/);
    assert.equal(parsed.regex, null);
  });

  it('rejects stateful regex flags', () => {
    assert.match(parseQuery('/a/g').error, /g \/ y/);
  });

  it('rejects over-long queries', () => {
    const parsed = parseQuery('x'.repeat(MAX_QUERY_LENGTH + 1));
    assert.match(parsed.error, /查询过长/);
  });
});

describe('matching', () => {
  it('matches substrings case- and width-insensitively', () => {
    assert.equal(normalizeForMatch('  Ｒegex  '), 'regex');
    const result = searchEntries(entries, 'REGEX');
    assert.ok(result.results.some((hit) => hit.entry.id === 'regex'));
  });

  it('exact mode only matches whole values', () => {
    const exact = searchEntries(entries, '=熵');
    assert.deepEqual(
      exact.results.map((hit) => hit.entry.id),
      ['entropy'],
    );
    const partial = searchEntries(entries, '=ent');
    assert.deepEqual(partial.results, []);
  });

  it('exact mode also matches aliases', () => {
    const result = searchEntries(entries, '=enthalpy');
    assert.deepEqual(
      result.results.map((hit) => hit.entry.id),
      ['enthalpy'],
    );
  });

  it('regex mode matches names', () => {
    const result = searchEntries(entries, '/^焓$/');
    assert.deepEqual(
      result.results.map((hit) => hit.entry.id),
      ['enthalpy'],
    );
  });

  it('regex mode does not search the body unless scoped', () => {
    assert.equal(searchEntries(entries, '/H\\(X\\)/').results.length, 0);
    const scoped = searchEntries(entries, 'content:/H\\(X\\)/');
    assert.deepEqual(
      scoped.results.map((hit) => hit.entry.id),
      ['entropy'],
    );
  });

  it('contains mode searches the body as a fallback', () => {
    const result = searchEntries(entries, 'pV');
    assert.deepEqual(
      result.results.map((hit) => hit.entry.id),
      ['enthalpy'],
    );
    assert.deepEqual(result.results[0].fields, ['content']);
  });

  it('scopes to tags', () => {
    const result = searchEntries(entries, 'tag:文本');
    assert.deepEqual(
      result.results.map((hit) => hit.entry.id),
      ['regex'],
    );
  });

  it('ranks an exact name match first', () => {
    const result = searchEntries(entries, '熵');
    assert.equal(result.results[0].entry.id, 'entropy');
    assert.ok(result.results[0].score >= 1000);
  });

  it('ranks name matches above body matches', () => {
    const result = searchEntries(entries, 'enthal');
    assert.equal(result.results[0].entry.id, 'enthalpy');
  });

  it('returns everything sorted for an empty query', () => {
    const result = searchEntries(entries, '');
    assert.equal(result.results.length, entries.length);
    assert.equal(result.parsed.isEmpty, true);
  });

  it('reports a parser error and no results', () => {
    const result = searchEntries(entries, '/[/');
    assert.equal(result.results.length, 0);
    assert.match(result.error, /无效/);
  });

  it('describes the effective query', () => {
    assert.equal(describeQuery(parseQuery('')), '浏览全部词条（按首字母排序）');
    assert.match(describeQuery(parseQuery('=熵')), /精确匹配/);
    assert.match(describeQuery(parseQuery('tag:x')), /tags/);
  });

  it('exposes the searched fields', () => {
    assert.deepEqual(fieldsForQuery(parseQuery('')), ['name']);
    assert.deepEqual(fieldsForQuery(parseQuery('/x/')), ['name', 'aliases', 'tags', 'summary']);
    assert.deepEqual(fieldsForQuery(parseQuery('text:x')), [
      'name',
      'aliases',
      'tags',
      'summary',
      'content',
    ]);
  });

  it('refuses catastrophic backtracking patterns instead of hanging', () => {
    // (a+)+b against a long run of "a" would freeze the tab: the parser must
    // reject it before any matching happens.
    const result = searchEntries(entries, '/(a+)+b/');
    assert.equal(result.results.length, 0);
    assert.match(result.error, /灾难性回溯/);
    assert.equal(result.scanned, 0);
  });

  it('flags risky shapes through assessRegexRisk', () => {
    assert.equal(assessRegexRisk('a+').risky, false);
    assert.equal(assessRegexRisk('^(熵|焓)$').risky, false);
    assert.equal(assessRegexRisk('(a+)+').risky, true);
    assert.equal(assessRegexRisk('(a|a)+').risky, true);
    assert.equal(assessRegexRisk('.*.*x').risky, true);
  });

  it('truncates very long subjects for regex matching', () => {
    const long = { id: 'long', name: 'x'.repeat(10), aliases: [], tags: [], summary: '', content: 'y'.repeat(9000) + 'NEEDLE' };
    assert.equal(searchEntries([long], 'content:/NEEDLE/').results.length, 0);
    assert.equal(searchEntries([long], 'content:/^y+/').results.length, 1);
  });

  it('enforces the time budget on expensive input', () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({
      id: `e${index}`,
      name: `entry ${index} ${'a'.repeat(200)}`,
      aliases: [],
      tags: [],
      summary: '',
      content: '',
    }));
    const result = searchEntries(many, '/a{1,200}b/', { budgetMs: 0 });
    assert.equal(result.truncated, true);
    assert.ok(result.scanned < many.length);
    assert.match(result.error, /部分结果/);
  });

  it('caps the number of results', () => {
    const result = searchEntries(entries, 'e', { maxResults: 2 });
    assert.equal(result.results.length, 2);
    assert.equal(result.truncated, true);
  });
});

describe('matchEntry', () => {
  it('returns null for an empty or invalid query', () => {
    assert.equal(matchEntry(entries[0], parseQuery('')), null);
    assert.equal(matchEntry(entries[0], parseQuery('/[/')), null);
  });
});

describe('highlighting', () => {
  it('finds every occurrence of a contains term', () => {
    const ranges = findMatches('熵与信息熵', parseQuery('熵'));
    assert.deepEqual(ranges, [
      { start: 0, end: 1 },
      { start: 4, end: 5 },
    ]);
  });

  it('finds regex matches', () => {
    const ranges = findMatches('a-b-c', parseQuery('/[a-c]/'));
    assert.equal(ranges.length, 3);
  });

  it('splits a value into matched and unmatched runs', () => {
    const parts = splitByMatches('熵论', findMatches('熵论', parseQuery('熵')));
    assert.deepEqual(parts, [
      { text: '熵', match: true },
      { text: '论', match: false },
    ]);
  });

  it('returns nothing for an empty query', () => {
    assert.deepEqual(findMatches('abc', parseQuery('')), []);
  });
});