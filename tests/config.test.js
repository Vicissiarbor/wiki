import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CONFIG,
  isRelativePath,
  loadConfig,
  mergeConfig,
  normalizeConfig,
} from '../web/js/config.js';
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
    const config = normalizeConfig({ site: { title: '  ' }, data: { url: '' } });
    assert.equal(config.site.title, DEFAULT_CONFIG.site.title);
    assert.equal(config.data.url, DEFAULT_CONFIG.data.url);
    assert.equal(config.search.maxResults, DEFAULT_CONFIG.search.maxResults);
  });

  it('accepts a full configuration', () => {
    const config = normalizeConfig({
      site: { title: '我的词典', tagline: 't', footer: 'f', updatedLabel: '更新' },
      data: { url: './data/other.json', timeoutMs: 1000 },
      search: { budgetMs: 100, maxResults: 10 },
    });
    assert.equal(config.site.title, '我的词典');
    assert.equal(config.data.url, './data/other.json');
    assert.equal(config.search.budgetMs, 100);
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
    assert.equal(config.site.title, DEFAULT_CONFIG.site.title);
    assert.equal(config.data.url, './data/entries.json');
    assert.deepEqual(warnings, []);
  });

  it('merges config.json over the defaults', async () => {
    const { fetch } = createFetchStub({
      '*': { body: { site: { title: '词典' }, data: { url: 'data/other.json' } } },
    });
    const { config } = await loadConfig({ fetchImpl: fetch, configUrl: './config.json' });
    assert.equal(config.site.title, '词典');
    assert.equal(config.data.url, 'data/other.json');
  });

  it('refuses an absolute data URL, because the site must stay portable', async () => {
    const { fetch } = createFetchStub({
      '*': { body: { data: { url: 'https://example.com/entries.json' } } },
    });
    const { config, warnings } = await loadConfig({ fetchImpl: fetch });
    assert.equal(config.data.url, DEFAULT_CONFIG.data.url);
    assert.match(warnings[0], /相对路径/);
  });

  it('warns about a broken config.json but keeps working', async () => {
    const { fetch } = createFetchStub({ '*': { status: 500, body: {} } });
    const { config, warnings } = await loadConfig({ fetchImpl: fetch });
    assert.equal(config.site.title, DEFAULT_CONFIG.site.title);
    assert.match(warnings[0], /500/);
  });
});