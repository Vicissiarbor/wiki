/**
 * Test output must be readable in a terminal: no ANSI escapes, no unordered
 * objects. These helpers keep the suite's diagnostics stable and small.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOCALES,
  localizeEntries,
  localizeEntry,
  localizedText,
  localeTag,
  normalizeLocale,
} from '../web/js/core/locale.js';
import { LANGUAGE_STRINGS, createTranslator, missingKeys } from '../web/js/core/i18n.js';
import { EntryCollection } from '../web/js/core/collection.js';
import { normalizeEntry } from '../web/js/core/entry.js';
import { searchEntries } from '../web/js/core/search.js';

/** An entry with a Chinese overlay on most fields, and one field without. */
const bilingual = normalizeEntry({
  id: 'complexNumber',
  name: 'Complex Number',
  nameZh: '复数',
  aliases: ['complex'],
  aliasesZh: ['虚数'],
  tags: ['Math'],
  tagsZh: ['数学'],
  summary: 'An ordered pair.',
  summaryZh: '一个有序对。',
  content: 'A *complex number* is $(a, b)$.',
  contentZh: '复数是一个有序对 $(a, b)$。',
  initial: '',
  updatedAt: '2026-10-04',
});

/** English only: the Chinese fields are empty. */
const englishOnly = normalizeEntry({
  id: 'abandon',
  name: 'abandon',
  summary: 'To give up.',
  content: 'never abandon a friend',
});

describe('normalizeLocale / localeTag', () => {
  it('accepts the supported codes and falls back to the default', () => {
    assert.deepEqual([...LOCALES], ['en', 'zh']);
    assert.equal(normalizeLocale('zh'), 'zh');
    assert.equal(normalizeLocale('en'), 'en');
    assert.equal(normalizeLocale('de'), 'en');
    assert.equal(normalizeLocale(undefined), 'en');
    assert.equal(normalizeLocale('de', 'zh'), 'zh');
  });

  it('maps a locale to a BCP-47 tag', () => {
    assert.equal(localeTag('zh'), 'zh-Hans-CN');
    assert.equal(localeTag('en'), 'en');
  });
});

describe('localizedText', () => {
  it('accepts a plain string for every language', () => {
    assert.equal(localizedText('Glossary', 'en'), 'Glossary');
    assert.equal(localizedText('Glossary', 'zh'), 'Glossary');
  });

  it('picks the requested language, then falls back to English', () => {
    const value = { en: 'Glossary', zh: '词条库' };
    assert.equal(localizedText(value, 'en'), 'Glossary');
    assert.equal(localizedText(value, 'zh'), '词条库');
    assert.equal(localizedText({ en: 'Only English' }, 'zh'), 'Only English');
    assert.equal(localizedText({ zh: '只有中文' }, 'en'), '只有中文');
  });

  it('handles missing values', () => {
    assert.equal(localizedText(undefined, 'en', 'fallback'), 'fallback');
    assert.equal(localizedText(null, 'zh'), '');
    assert.equal(localizedText({}, 'en', 'x'), 'x');
    assert.equal(localizedText(42, 'en', 'x'), 'x');
  });
});

describe('localizeEntry', () => {
  it('returns the English fields by default', () => {
    const entry = localizeEntry(bilingual, 'en');
    assert.equal(entry.name, 'Complex Number');
    assert.deepEqual(entry.aliases, ['complex']);
    assert.deepEqual(entry.tags, ['Math']);
    assert.equal(entry.summary, 'An ordered pair.');
    assert.equal(entry.content, 'A *complex number* is $(a, b)$.');
    // The other language is offered as a subtitle.
    assert.equal(entry.alternateName, '复数');
  });

  it('uses the Chinese overlay when asked for Chinese', () => {
    const entry = localizeEntry(bilingual, 'zh');
    assert.equal(entry.name, '复数');
    assert.deepEqual(entry.aliases, ['虚数']);
    assert.deepEqual(entry.tags, ['数学']);
    assert.equal(entry.summary, '一个有序对。');
    assert.equal(entry.content, '复数是一个有序对 $(a, b)$。');
    // English is never missing, so it becomes the subtitle.
    assert.equal(entry.alternateName, 'Complex Number');
  });

  it('falls back per field, not per entry', () => {
    // A Chinese body on an entry that keeps its English name.
    const partly = normalizeEntry({
      id: 'tree',
      name: 'Tree',
      content: 'A tree.',
      contentZh: '一棵树。',
    });
    const entry = localizeEntry(partly, 'zh');
    assert.equal(entry.name, 'Tree');
    assert.equal(entry.content, '一棵树。');
    assert.equal(entry.alternateName, '', 'the name is the same in both languages');
  });

  it('shows English for an entry without any Chinese', () => {
    const entry = localizeEntry(englishOnly, 'zh');
    assert.equal(entry.name, 'abandon');
    assert.equal(entry.content, 'never abandon a friend');
    assert.equal(entry.alternateName, 'abandon' === entry.name ? '' : entry.alternateName);
    assert.equal(entry.alternateName, '');
  });

  it('keeps timestamps and the id untouched', () => {
    const entry = localizeEntry(bilingual, 'zh');
    assert.equal(entry.id, 'complexNumber');
    assert.equal(entry.updatedAt, '2026-10-04');
  });

  it('honours a per-language initial override', () => {
    const entry = normalizeEntry({ id: 'x', name: 'Complex Number', nameZh: '复数', initialZh: 'F' });
    assert.equal(localizeEntry(entry, 'en').initial, '');
    assert.equal(localizeEntry(entry, 'zh').initial, 'F');
  });

  it('localizes a list of entries', () => {
    const localized = localizeEntries([bilingual, englishOnly], 'zh');
    assert.deepEqual(
      localized.map((entry) => entry.name),
      ['复数', 'abandon'],
    );
  });
});

describe('search covers both languages', () => {
  const { collection } = EntryCollection.fromDocument({ entries: [bilingual, englishOnly] });

  it('finds an entry by its Chinese name while the interface is English', () => {
    const outcome = searchEntries(collection.entries, '复数');
    assert.deepEqual(
      outcome.results.map((hit) => hit.entry.id),
      ['complexNumber'],
    );
  });

  it('finds an entry by its English name while the interface is Chinese', () => {
    const outcome = searchEntries(collection.entries, '=Complex Number');
    assert.deepEqual(
      outcome.results.map((hit) => hit.entry.id),
      ['complexNumber'],
    );
  });

  it('searches Chinese aliases, tags and bodies too', () => {
    for (const query of ['虚数', 'tag:数学', 'content:有序对', '=abandon']) {
      const outcome = searchEntries(collection.entries, query);
      assert.ok(outcome.results.length > 0, `${query} found nothing`);
    }
  });
});

describe('translator', () => {
  it('translates in both languages', () => {
    assert.equal(createTranslator('en')('search.submit'), 'Find');
    assert.equal(createTranslator('zh')('search.submit'), '查找');
  });

  it('fills parameters', () => {
    assert.equal(createTranslator('en')('count.total', { count: 3 }), '3 entries');
    assert.equal(createTranslator('zh')('count.total', { count: 3 }), '共 3 条');
    assert.equal(
      createTranslator('zh')('empty.noMatch', { query: '熵' }),
      '没有匹配「熵」的词条。',
    );
  });

  it('leaves unknown placeholders alone', () => {
    assert.equal(createTranslator('en')('count.total'), '{count} entries');
  });

  it('falls back to English for an unknown locale', () => {
    assert.equal(createTranslator('de')('search.submit'), 'Find');
  });

  it('accepts overrides', () => {
    assert.equal(createTranslator('en', { 'search.submit': 'Go' })('search.submit'), 'Go');
  });

  it('has a complete Chinese dictionary', () => {
    assert.deepEqual(missingKeys('zh'), []);
    assert.deepEqual(missingKeys('en'), []);
  });

  it('never ships a key that only exists in one language by accident', () => {
    // Plural variants (`key.one`) are English-only on purpose; everything else
    // must exist in every language, and no language may invent extra keys.
    const reference = Object.keys(LANGUAGE_STRINGS.en).filter((key) => !key.endsWith('.one'));
    for (const locale of LOCALES) {
      const keys = Object.keys(LANGUAGE_STRINGS[locale]).filter((key) => !key.endsWith('.one'));
      assert.deepEqual(keys.sort(), reference.sort(), `${locale} has a different key set`);
    }
  });

  it('uses singular wording for a count of one', () => {
    assert.equal(createTranslator('en')('count.total', { count: 1 }), '1 entry');
    assert.equal(createTranslator('en')('count.total', { count: 2 }), '2 entries');
    assert.equal(createTranslator('en')('count.matched', { count: 1 }), '1 match');
    // Chinese has no plural form: the base string is used for every count.
    assert.equal(createTranslator('zh')('count.total', { count: 1 }), '共 1 条');
    assert.equal(createTranslator('zh')('count.matched', { count: 1 }), '命中 1 条');
  });

  it('warns instead of failing on a missing key', () => {
    const warn = console.warn;
    /** @type {string[]} */
    const seen = [];
    console.warn = (/** @type {string} */ message) => seen.push(message);
    try {
      assert.equal(createTranslator('en')('nope.nothing'), 'nope.nothing');
    } finally {
      console.warn = warn;
    }
    assert.equal(seen.length, 1);
    assert.match(seen[0], /nope\.nothing/);
  });
});