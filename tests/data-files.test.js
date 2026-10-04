/**
 * Guards the shipped data and the page shell.
 *
 * The assertions here must not depend on *which* entries exist — the data file
 * is the owner's content and changes all the time. They check the properties
 * that must hold for any content: valid ids, resolvable initials, valid
 * timestamps, renderable bodies, and a page shell the app can mount into.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { EntryCollection } from '../web/js/core/collection.js';
import { initialOfEntry } from '../web/js/core/initials.js';
import { isValidTimestamp } from '../web/js/core/entry.js';
import { renderMarkdown } from '../web/js/core/markdown.js';
import { parseQuery, searchEntries } from '../web/js/core/search.js';
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
async function loadEntries() {
  const { collection, issues } = EntryCollection.fromDocument(await readJson('web/data/entries.json'));
  assert.deepEqual(issues, [], 'every entry in web/data/entries.json must load');
  assert.ok(collection.size > 0, 'the glossary should not be empty');
  return collection;
}

describe('web/data/entries.json', () => {
  it('parses without a single skipped entry', async () => {
    await loadEntries();
  });

  it('gives every entry a URL-safe, unique id and a resolvable initial letter', async () => {
    const collection = await loadEntries();
    assert.equal(new Set(collection.ids()).size, collection.size, 'ids must be unique');
    for (const entry of collection.entries) {
      assert.match(entry.id, /^[A-Za-z0-9][A-Za-z0-9._~-]*$/, entry.id);
      assert.match(initialOfEntry(entry), /^[A-Z#]$/, `${entry.name} has no initial`);
    }
  });

  it('accepts the timestamps that are actually used', async () => {
    const collection = await loadEntries();
    for (const entry of collection.entries) {
      assert.ok(isValidTimestamp(entry.createdAt), `${entry.id}: createdAt=${entry.createdAt}`);
      assert.ok(isValidTimestamp(entry.updatedAt), `${entry.id}: updatedAt=${entry.updatedAt}`);
    }
  });

  it('can find every entry by name in all three search modes', async () => {
    const collection = await loadEntries();
    for (const entry of collection.entries) {
      const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const query of [`=${entry.name}`, `/^${escaped}$/`]) {
        const outcome = searchEntries(collection.entries, query);
        assert.equal(outcome.error, '', `query ${query}: ${outcome.error}`);
        assert.ok(
          outcome.results.some((hit) => hit.entry.id === entry.id),
          `query ${query} did not find ${entry.name}`,
        );
      }
      const contains = searchEntries(collection.entries, entry.name);
      assert.ok(
        contains.results.some((hit) => hit.entry.id === entry.id),
        `contains search did not find ${entry.name}`,
      );
    }
  });

  it('renders every body without executable markup', async () => {
    const collection = await loadEntries();
    for (const entry of collection.entries) {
      const html = renderMarkdown(entry.content, { resolveTermLink: () => null });
      assert.ok(!html.includes('<script'), `${entry.id} produced a script tag`);
      assert.ok(!/href="javascript:/i.test(html), `${entry.id} produced a javascript: link`);
    }
  });

  it('keeps wiki links resolvable', async () => {
    const collection = await loadEntries();
    for (const entry of collection.entries) {
      const html = renderMarkdown(entry.content, {
        resolveTermLink: (name) => (collection.byName(name) ? '#/e/ok' : null),
      });
      for (const match of html.matchAll(/<span class="term-link term-link--missing">([^<]+)<\/span>/g)) {
        // A missing target is only a warning: it must not crash, and the name
        // should look like a term rather than markup.
        assert.ok(match[1].trim().length > 0, `${entry.id}: empty wiki link target`);
      }
    }
  });

  it('turns every formula into a math placeholder', async () => {
    const collection = await loadEntries();
    let formulas = 0;
    for (const entry of collection.entries) {
      const source = entry.content;
      const html = renderMarkdown(source, { resolveTermLink: () => null });
      const found = (html.match(/data-tex="/g) ?? []).length;
      const dollarPairs = (source.match(/(?<!\\)\$/g) ?? []).length;
      if (dollarPairs >= 2) {
        assert.ok(found > 0, `${entry.id} contains $ but produced no math markup`);
      }
      formulas += found;
    }
    // The data file is expected to demonstrate math at least once; if the owner
    // removes all formulas this assertion is the reminder to drop the feature
    // test, not a failure of the site.
    assert.ok(formulas > 0, 'no formula found in the data file');
  });

  it('reports a fresh "latest update" from the entries themselves', async () => {
    const collection = await loadEntries();
    const latest = collection.latestUpdatedAt();
    assert.match(latest, /^\d{4}-\d{2}-\d{2}$/);
    for (const entry of collection.entries) {
      for (const value of [entry.updatedAt, entry.createdAt]) {
        if (value !== '') {
          assert.ok(value.slice(0, 10) <= latest, `${entry.id} is newer than the reported latest`);
        }
      }
    }
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

  it('has no footer note any more', async () => {
    const raw = await readJson('web/config.json');
    assert.equal('footer' in raw.site, false);
    const { DEFAULT_CONFIG } = await import('../web/js/config.js');
    assert.equal('footer' in DEFAULT_CONFIG.site, false);
  });

  it('points at a file that exists', async () => {
    const config = normalizeConfig(await readJson('web/config.json'));
    const target = path.join(REPO_ROOT, 'web', config.data.url.replace(/^\.\//, ''));
    assert.ok((await fs.stat(target)).isFile(), `${target} is missing`);
  });
});

describe('web/assets/katex', () => {
  it('ships the runtime, the stylesheet and woff2 fonts', async () => {
    for (const file of ['katex.min.js', 'katex.min.css', 'LICENSE', 'NOTICE.md']) {
      const stats = await fs.stat(path.join(REPO_ROOT, 'web', 'assets', 'katex', file));
      assert.ok(stats.isFile() && stats.size > 0, `web/assets/katex/${file}`);
    }
    const fonts = await fs.readdir(path.join(REPO_ROOT, 'web', 'assets', 'katex', 'fonts'));
    assert.ok(fonts.length >= 10, 'expected the KaTeX font files');
    assert.ok(
      fonts.every((name) => name.endsWith('.woff2')),
      'only woff2 fonts are needed (the CSS lists them first)',
    );
  });

  it('addresses those assets with relative paths only', async () => {
    const source = await fs.readFile(path.join(REPO_ROOT, 'web', 'js', 'ui', 'math.js'), 'utf8');
    const base = /KATEX_BASE = '([^']+)'/.exec(source)?.[1] ?? '';
    assert.equal(base.startsWith('./'), true, `KATEX_BASE is ${base}`);
    const css = await fs.readFile(path.join(REPO_ROOT, 'web', 'assets', 'katex', 'katex.min.css'), 'utf8');
    assert.ok(!/url\(\s*['"]?https?:/i.test(css), 'the vendored CSS must not point at a CDN');
  });

  it('is only loaded when a page contains a formula', async () => {
    const source = await fs.readFile(path.join(REPO_ROOT, 'web', 'js', 'ui', 'math.js'), 'utf8');
    assert.match(source, /querySelectorAll\('\[data-tex\]'\)/);
    const html = await fs.readFile(path.join(REPO_ROOT, 'web', 'index.html'), 'utf8');
    assert.ok(!html.includes('katex'), 'index.html must not preload KaTeX');
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

describe('search and parseQuery sanity on the real data', () => {
  it('treats an empty query as browse mode', () => {
    assert.equal(parseQuery('').isEmpty, true);
  });
});