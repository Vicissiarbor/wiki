import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CONFIG,
  SETTINGS_KEY,
  loadConfig,
  mergeConfig,
  normalizeConfig,
  readOverrides,
  writeOverrides,
} from '../web/js/config.js';
import { createFetchStub, memoryStorage } from './helpers/index.js';

describe('mergeConfig', () => {
  it('merges nested objects and replaces arrays', () => {
    const merged = mergeConfig(
      { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] },
      { nested: { y: 3 }, list: [9], extra: true },
    );
    assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 3 }, list: [9], extra: true });
  });

  it('ignores non-object patches and undefined values', () => {
    assert.deepEqual(mergeConfig({ a: 1 }, null), { a: 1 });
    assert.deepEqual(mergeConfig({ a: 1 }, { a: undefined }), { a: 1 });
  });
});

describe('normalizeConfig', () => {
  it('falls back for unknown sources and empty values', () => {
    const config = normalizeConfig({ source: 'ftp', data: { url: '  ' }, github: { branch: '' } });
    assert.equal(config.source, 'json');
    assert.equal(config.data.url, DEFAULT_CONFIG.data.url);
    assert.equal(config.github.branch, 'main');
    assert.equal(config.search.budgetMs, DEFAULT_CONFIG.search.budgetMs);
  });

  it('strips trailing slashes from the REST base URL', () => {
    assert.equal(normalizeConfig({ rest: { baseUrl: 'http://host:8787///' } }).rest.baseUrl, 'http://host:8787');
  });
});

describe('overrides', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    assert.deepEqual(readOverrides(storage), {});
    writeOverrides(storage, { source: 'local', github: { owner: 'me' } });
    writeOverrides(storage, { github: { repo: 'repo' } });
    const overrides = readOverrides(storage);
    assert.equal(overrides.source, 'local');
    assert.deepEqual(overrides.github, { owner: 'me', repo: 'repo' });
    assert.ok(storage.get(SETTINGS_KEY, null));
  });

  it('ignores corrupted storage', () => {
    const storage = memoryStorage();
    storage.set(SETTINGS_KEY, 'not-an-object');
    assert.deepEqual(readOverrides(storage), {});
  });
});

describe('loadConfig', () => {
  it('uses defaults when config.json is absent', async () => {
    const { fetch } = createFetchStub({});
    const result = await loadConfig({ storage: memoryStorage(), fetchImpl: fetch });
    assert.equal(result.loadedFromConfigFile, false);
    assert.equal(result.config.source, 'json');
    assert.deepEqual(result.warnings, []);
  });

  it('merges config.json, then per-device overrides', async () => {
    const storage = memoryStorage();
    writeOverrides(storage, { source: 'local' });
    const { fetch } = createFetchStub({
      '*': { body: { site: { title: '我的词条库' }, data: { url: './data/other.json' } } },
    });
    const result = await loadConfig({ storage, fetchImpl: fetch, configUrl: './config.json' });
    assert.equal(result.loadedFromConfigFile, true);
    assert.equal(result.config.site.title, '我的词条库');
    assert.equal(result.config.data.url, './data/other.json');
    assert.equal(result.config.source, 'local');
  });

  it('warns when config.json holds a token', async () => {
    const { fetch } = createFetchStub({
      '*': { body: { rest: { baseUrl: 'http://host', token: 'secret' } } },
    });
    const result = await loadConfig({ storage: memoryStorage(), fetchImpl: fetch });
    assert.match(result.warnings[0], /令牌/);
  });

  it('survives a failing config.json', async () => {
    const { fetch } = createFetchStub({ '*': { status: 500, body: {} } });
    const result = await loadConfig({ storage: memoryStorage(), fetchImpl: fetch });
    assert.equal(result.config.source, 'json');
    assert.match(result.warnings[0], /500/);
  });
});