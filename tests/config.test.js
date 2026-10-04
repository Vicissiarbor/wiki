import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CONFIG,
  isRelativePath,
  loadConfig,
  mergeConfig,
  normalizeConfig,
} from '../web/js/config.js';
import { localizedText, normalizeLocale } from '../web/js/core/locale.js';
import { createFetchStub } from './helpers/index.js';

describe('mergeConfig', () => {
  it('merges nested objects and replaces other values', () => {
    assert.deepEqual(mergeConfig({ a: 1, nest: { x: 1, y: 2 } }, { nest: { y: 3 }, b: true }), {
      a: 1,
      nest: { x: 1, y: 3 },
      b: true,
    });
  });

  it('ignores non-objects and undefined values', () => {
    assert.deepEqual(mergeConfig({ a: 1 }, null), { a: 1 });
    assert.deepEqual(mergeConfig({ a: 1 }, { a: undefined }), { a: 1 });
  });
});

describe('normalizeConfig', () => {
  it('falls back for empty values', () => {
    const config = normalizeConfig({ site: { title: '', defaultLocale: 'nope' }, data: { url: '' } });
    assert.deepEqual(config.site.title, DEFAULT_CONFIG.site.title);
    assert.equal(config.site.defaultLocale, 'en');
    assert.equal(config.data.url, DEFAULT_CONFIG.data.url);
    assert.equal(config.search.maxResults, DEFAULT_CONFIG.search.maxResults);
  });

  it('accepts a full configuration, with per-language site text', () => {
    const config = normalizeConfig({
      site: {
        title: { en: 'My Glossary', zh: '我的词典' },
        tagline: 't',
        updatedLabel: 'Updated',
        defaultLocale: 'zh',
      },
      data: { url: './data/other.json', timeoutMs: 1000 },
      search: { budgetMs: 100, maxResults: 10 },
    });
    assert.equal(localizedText(config.site.title, 'en'), 'My Glossary');
    assert.equal(localizedText(config.site.title, 'zh'), '我的词典');
    // A plain string serves every language.
    assert.equal(localizedText(config.site.tagline, 'zh'), 't');
    assert.equal(config.site.defaultLocale, 'zh');
    assert.equal(config.data.url, './data/other.json');
    assert.equal(config.search.budgetMs, 100);
  });

  it('normalizes the default locale', () => {
    assert.equal(normalizeLocale('zh'), 'zh');
    assert.equal(normalizeLocale('ZH'), 'en');
    assert.equal(normalizeLocale(undefined, 'zh'), 'zh');
    assert.equal(normalizeLocale('fr', 'zh'), 'zh');
  });
});

describe('isRelativePath', () => {
  it('accepts relative paths and rejects everything anchored', () => {
    for (const value of ['./data/entries.json', 'data/entries.json', '../x.json', '']) {
      assert.equal(isRelativePath(value), true, value);
    }
    for (const value of ['/data/entries.json', '//host/x.json', 'https://example.com/x.json', 'http://x']) {
      assert.equal(isRelativePath(value), false, value);
    }
  });
});

describe('loadConfig', () => {
  it('uses built-in defaults when config.json is absent', async () => {
    const { fetch } = createFetchStub({});
    const { config, warnings } = await loadConfig({ fetchImpl: fetch });
    assert.deepEqual(config.site.title, DEFAULT_CONFIG.site.title);
    assert.equal(config.data.url, './data/entries.json');
    assert.deepEqual(warnings, []);
  });

  it('merges config.json over the defaults', async () => {
    const { fetch } = createFetchStub({
      '*': { body: { site: { title: '词典', defaultLocale: 'zh' }, data: { url: 'data/other.json' } } },
    });
    const { config } = await loadConfig({ fetchImpl: fetch, configUrl: './config.json' });
    assert.equal(localizedText(config.site.title, 'en'), '词典');
    assert.equal(config.site.defaultLocale, 'zh');
    assert.equal(config.data.url, 'data/other.json');
  });

  it('refuses an absolute data URL, because the site must stay portable', async () => {
    const { fetch } = createFetchStub({
      '*': { body: { data: { url: 'https://example.com/entries.json' } } },
    });
    const { config, warnings } = await loadConfig({ fetchImpl: fetch });
    assert.equal(config.data.url, DEFAULT_CONFIG.data.url);
    // Warnings are keys plus parameters: the language is not known yet here.
    assert.equal(warnings[0].key, 'config.notRelative');
    assert.equal(warnings[0].params.url, 'https://example.com/entries.json');
  });

  it('warns about a broken config.json but keeps working', async () => {
    const { fetch } = createFetchStub({ '*': { status: 500, body: {} } });
    const { config, warnings } = await loadConfig({ fetchImpl: fetch });
    assert.deepEqual(config.site.title, DEFAULT_CONFIG.site.title);
    assert.equal(warnings[0].key, 'config.unreadable');
    assert.equal(warnings[0].params.status, 500);
  });
});