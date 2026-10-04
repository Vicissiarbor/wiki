/**
 * Guards the shipped data files: the sample glossary must stay loadable, and
 * config.json must stay a valid, token-free configuration.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { EntryCollection } from '../web/js/core/collection.js';
import { initialOfEntry } from '../web/js/core/initials.js';
import { groupEntriesByInitial } from '../web/js/core/sort.js';
import { searchEntries } from '../web/js/core/search.js';
import { normalizeConfig } from '../web/js/config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} relative
 * @returns {Promise<any>}
 */
async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, relative), 'utf8'));
}

describe('web/data/entries.json', () => {
  it('parses without a single skipped entry', async () => {
    const raw = await readJson('web/data/entries.json');
    const { collection, issues } = EntryCollection.fromDocument(raw);
    assert.deepEqual(issues, []);
    assert.ok(collection.size >= 5, 'the sample glossary should be non-trivial');
  });

  it('gives every entry a resolvable initial letter and a stable id', async () => {
    const { collection } = EntryCollection.fromDocument(await readJson('web/data/entries.json'));
    for (const entry of collection.entries) {
      assert.match(entry.id, /^[A-Za-z0-9][A-Za-z0-9._~-]*$/);
      assert.match(initialOfEntry(entry), /^[A-Z#]$/);
    }
  });

  it('groups into buckets that match the expected sample letters', async () => {
    const { collection } = EntryCollection.fromDocument(await readJson('web/data/entries.json'));
    const letters = groupEntriesByInitial(collection.entries).map((group) => group.letter);
    for (const letter of ['C', 'S', 'Z', '#']) {
      assert.ok(letters.includes(letter), `expected a bucket for ${letter}`);
    }
  });

  it('is searchable in every documented mode', async () => {
    const { collection } = EntryCollection.fromDocument(await readJson('web/data/entries.json'));
    const queries = ['熵', '=熵', '/^熵/', 'tag:物理', 'content:/H\\(X\\)/', '正则'];
    for (const query of queries) {
      const outcome = searchEntries(collection.entries, query);
      assert.equal(outcome.error, '', `query ${query} failed: ${outcome.error}`);
      assert.ok(outcome.results.length > 0, `query ${query} found nothing`);
    }
  });

  it('renders wiki links that resolve inside the sample data', async () => {
    const { collection } = EntryCollection.fromDocument(await readJson('web/data/entries.json'));
    const { renderMarkdown } = await import('../web/js/core/markdown.js');
    const linked = collection.entries.filter((entry) => entry.content.includes('[['));
    assert.ok(linked.length > 0, 'the sample data should demonstrate [[wiki links]]');

    let resolvedCount = 0;
    for (const entry of linked) {
      const html = renderMarkdown(entry.content, {
        resolveTermLink: (name) => (collection.byName(name) ? '#/?e=ok' : null),
      });
      resolvedCount += (html.match(/class="term-link"/g) ?? []).length;
    }
    assert.ok(resolvedCount > 0, 'at least one wiki link should point at an existing entry');
  });

  it('keeps every entry body renderable without throwing', async () => {
    const { collection } = EntryCollection.fromDocument(await readJson('web/data/entries.json'));
    const { renderMarkdown } = await import('../web/js/core/markdown.js');
    for (const entry of collection.entries) {
      const html = renderMarkdown(entry.content, { resolveTermLink: () => null });
      assert.ok(!html.includes('<script'), `${entry.id} produced a script tag`);
    }
  });
});

describe('web/config.json', () => {
  it('is valid and contains no secrets', async () => {
    const raw = await readJson('web/config.json');
    const config = normalizeConfig(raw);
    assert.equal(config.source, 'json');
    assert.equal(config.rest.token, '');
    assert.equal(config.github.token, '');
    assert.match(config.data.url, /entries\.json$/);
  });
});

describe('web/index.html', () => {
  it('provides every element the app expects', async () => {
    const html = await fs.readFile(path.join(REPO_ROOT, 'web', 'index.html'), 'utf8');
    for (const selector of [
      'id="site-title"',
      'id="site-subtitle"',
      'id="site-stats"',
      'id="app-banner"',
      'id="search-host"',
      'id="initials-host"',
      'id="list-host"',
      'id="detail-host"',
      'id="toolbar-host"',
      'id="toasts"',
    ]) {
      assert.ok(html.includes(selector), `index.html is missing ${selector}`);
    }
    assert.match(html, /<script type="module" src="\.\/js\/boot\.js">/);
    assert.ok(!/<script(?![^>]*type="module")[^>]*>[\s\S]*?<\/script>/.test(html), 'no inline scripts');
  });

  it('ships a .nojekyll file so Pages does not process the site', async () => {
    const stat = await fs.stat(path.join(REPO_ROOT, 'web', '.nojekyll'));
    assert.ok(stat.isFile());
  });
});