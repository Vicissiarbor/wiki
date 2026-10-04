/**
 * Guards the shipped data and the page shell: the glossary must stay loadable,
 * the configuration must stay portable, and index.html must keep providing the
 * elements the app expects.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { EntryCollection } from '../web/js/core/collection.js';
import { initialOfEntry } from '../web/js/core/initials.js';
import { groupEntriesByInitial } from '../web/js/core/sort.js';
import { renderMarkdown } from '../web/js/core/markdown.js';
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

/** @returns {Promise<EntryCollection>} */
async function loadSample() {
  const { collection, issues } = EntryCollection.fromDocument(await readJson('web/data/entries.json'));
  assert.deepEqual(issues, []);
  return collection;
}

describe('web/data/entries.json', () => {
  it('parses without a single skipped entry', async () => {
    const collection = await loadSample();
    assert.ok(collection.size >= 5, 'the sample glossary should be non-trivial');
  });

  it('gives every entry a URL-safe id and a resolvable initial letter', async () => {
    const collection = await loadSample();
    for (const entry of collection.entries) {
      assert.match(entry.id, /^[A-Za-z0-9][A-Za-z0-9._~-]*$/, entry.id);
      assert.match(initialOfEntry(entry), /^[A-Z#]$/, entry.name);
    }
  });

  it('groups into buckets that match the expected sample letters', async () => {
    const collection = await loadSample();
    const letters = groupEntriesByInitial(collection.entries).map((group) => group.letter);
    for (const letter of ['C', 'S', 'Z', '#']) {
      assert.ok(letters.includes(letter), `expected a bucket for ${letter}`);
    }
  });

  it('is searchable in every documented mode', async () => {
    const collection = await loadSample();
    for (const query of ['熵', '=熵', '/^熵/', 'tag:物理', 'content:/H\\(X\\)/', '正则']) {
      const outcome = searchEntries(collection.entries, query);
      assert.equal(outcome.error, '', `query ${query} failed: ${outcome.error}`);
      assert.ok(outcome.results.length > 0, `query ${query} found nothing`);
    }
  });

  it('keeps wiki links resolvable and bodies free of executable markup', async () => {
    const collection = await loadSample();
    let resolved = 0;
    for (const entry of collection.entries) {
      const html = renderMarkdown(entry.content, {
        resolveTermLink: (name) =>
          collection.byName(name) ? `#/e/${encodeURIComponent(name)}` : null,
      });
      assert.ok(!html.includes('<script'), `${entry.id} produced a script tag`);
      resolved += (html.match(/class="term-link"(?!--missing)/g) ?? []).length;
    }
    assert.ok(resolved > 0, 'at least one [[wiki link]] should point at an existing entry');
  });

  it('has unique ids (a duplicate would break the index links)', async () => {
    const collection = await loadSample();
    assert.equal(new Set(collection.ids()).size, collection.size);
  });
});

describe('web/config.json', () => {
  it('is valid, portable and free of secrets', async () => {
    const config = normalizeConfig(await readJson('web/config.json'));
    assert.equal(config.data.url.startsWith('./'), true);
    assert.equal(typeof config.site.title, 'string');
    assert.ok(!JSON.stringify(config).includes('token'));
    assert.ok(!JSON.stringify(config).includes('http'));
  });

  it('points at a file that exists', async () => {
    const config = normalizeConfig(await readJson('web/config.json'));
    const target = path.join(REPO_ROOT, 'web', config.data.url.replace(/^\.\//, ''));
    assert.ok((await fs.stat(target)).isFile(), `${target} is missing`);
  });
});

describe('web/index.html', () => {
  it('provides every element the app expects', async () => {
    const html = await fs.readFile(path.join(REPO_ROOT, 'web', 'index.html'), 'utf8');
    for (const selector of [
      'id="site-title"',
      'id="site-tagline"',
      'id="search-host"',
      'id="status-host"',
      'id="view"',
      'id="site-footer"',
    ]) {
      assert.ok(html.includes(selector), `index.html is missing ${selector}`);
    }
  });

  it('loads exactly one module and no inline script', async () => {
    const html = await fs.readFile(path.join(REPO_ROOT, 'web', 'index.html'), 'utf8');
    assert.match(html, /<script type="module" src="\.\/js\/boot\.js"><\/script>/);
    assert.equal((html.match(/<script/g) ?? []).length, 1);
  });

  it('ships a .nojekyll file so Pages serves the directory as-is', async () => {
    assert.ok((await fs.stat(path.join(REPO_ROOT, 'web', '.nojekyll'))).isFile());
  });

  it('has no leftover reference to the removed stylesheet', async () => {
    for (const page of ['web/index.html', 'web/404.html']) {
      const html = await fs.readFile(path.join(REPO_ROOT, page), 'utf8');
      assert.ok(!html.includes('main.css'), `${page} still points at main.css`);
    }
  });
});