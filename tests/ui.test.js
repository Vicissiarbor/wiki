/**
 * Whole-site integration test: the real index.html, the real modules, a real
 * (jsdom) DOM and a stubbed network. The closest thing to "open the page".
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { boot } from '../web/js/app.js';
import { memoryStorage, response } from './helpers/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Fixtures: two Chinese names (pinyin buckets H/S), an ASCII name, an XSS attempt. */
const ENTRIES = {
  version: 1,
  updatedAt: '2025-01-01T00:00:00.000Z',
  entries: [
    {
      id: 'entropy',
      name: '熵',
      aliases: ['entropy', '信息熵'],
      tags: ['物理'],
      summary: '度量不确定性',
      content:
        '## 定义\n\nH(X) = -Σ p log p\n\n见 [[焓]] 与 [[不存在的词条]]\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
      updatedAt: '2025-01-02T00:00:00.000Z',
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
      id: 'xss',
      name: '注入测试',
      tags: ['安全'],
      summary: '不应执行任何脚本',
      content:
        '<img src=x onerror="window.__XSS__ = true">\n\n<script>window.__XSS__ = true</script>\n\n[危险](javascript:alert(1))',
    },
    {
      id: 'binary-search',
      name: 'Binary Search',
      tags: ['算法'],
      summary: 'log n lookup',
      content: 'see [[焓]]',
    },
  ],
};

/**
 * @param {{entries?: object, url?: string, failEntries?: boolean, config?: object}} [options]
 * @returns {Promise<{dom: JSDOM, app: object, store: object}>}
 */
async function startSite(options = {}) {
  const html = await fs.readFile(path.join(REPO_ROOT, 'web', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: options.url ?? 'https://example.test/ladr/',
    pretendToBeVisual: true,
  });
  installDomGlobals(dom);

  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('config.json')) {
      return options.config ? response(options.config, 200) : response({}, 404);
    }
    if (url.includes('entries.json')) {
      if (options.failEntries) {
        throw new TypeError('Failed to fetch');
      }
      return response(options.entries ?? ENTRIES, 200);
    }
    return response({}, 404);
  };

  const booted = await boot({
    root: dom.window.document,
    win: dom.window,
    fetchImpl: /** @type {any} */ (fetchImpl),
    storage: memoryStorage(),
    configUrl: './config.json',
  });
  return { dom, ...booted };
}

/**
 * @param {JSDOM} dom
 * @returns {void}
 */
function installDomGlobals(dom) {
  for (const name of [
    'window',
    'document',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
  ]) {
    Object.defineProperty(globalThis, name, {
      value: dom.window[name],
      configurable: true,
      writable: true,
    });
  }
}

/** @type {any} */
let DomEvent = globalThis.Event;

/**
 * @param {HTMLElement} node
 * @param {string} type
 * @returns {void}
 */
function fire(node, type) {
  node.dispatchEvent(new DomEvent(type, { bubbles: true, cancelable: true }));
}

/** @type {Awaited<ReturnType<typeof startSite>>} */
let site;
/** @type {Document} */
let doc;
/** @type {HTMLInputElement} */
let input;

/**
 * Follow a hash link the way a browser does: change the hash, then notify.
 * (jsdom does not implement fragment navigation on clicks.)
 *
 * @param {HTMLElement} node
 * @returns {void}
 */
function followLink(node) {
  const href = node.getAttribute('href') ?? '';
  assert.ok(href.startsWith('#'), `not a hash link: ${href}`);
  site.dom.window.location.hash = href;
  site.dom.window.dispatchEvent(new site.dom.window.Event('hashchange'));
}

/**
 * @param {string} value
 * @returns {void}
 */
function search(value) {
  input.value = value;
  fire(input, 'input');
}

/**
 * @returns {string[]} The names currently listed, in page order.
 */
function listed() {
  return [...doc.querySelectorAll('a.term')].map((node) => node.textContent);
}

describe('index page', () => {
  before(async () => {
    site = await startSite();
    doc = site.dom.window.document;
    DomEvent = site.dom.window.Event;
    input = /** @type {any} */ (doc.querySelector('#q'));
  });

  after(() => {
    site.app.destroy();
  });

  it('renders letter headings and one link per entry', () => {
    assert.deepEqual(
      [...doc.querySelectorAll('h2.letter')].map((node) => node.textContent),
      ['B', 'H', 'S', 'Z'], // Binary Search / 焓 hán / 熵 shāng / 注入测试 zhù
    );
    assert.deepEqual(listed(), ['Binary Search', '焓', '熵', '注入测试']);
  });

  it('links every entry with a hash route', () => {
    const hrefs = [...doc.querySelectorAll('a.term')].map((node) => node.getAttribute('href'));
    assert.deepEqual(hrefs, ['#/e/binary-search', '#/e/enthalpy', '#/e/entropy', '#/e/xss']);
    for (const href of hrefs) {
      assert.ok(href.startsWith('#/e/'), href);
      assert.ok(!href.includes('//'), href);
    }
  });

  it('provides the search box, a submit button and a hint line', () => {
    assert.ok(input);
    assert.equal(doc.querySelector('.search__label').textContent, '查询');
    assert.equal(doc.querySelector('.search__submit').textContent, '查找');
    assert.match(doc.querySelector('.search__hint').textContent, /浏览全部词条/);
  });

  it('shows the totals in the footer', () => {
    assert.match(doc.querySelector('#site-footer').textContent, /共 4 条/);
    assert.match(doc.querySelector('#site-footer').textContent, /更新于 2025-01-01/);
  });

  it('sets the document title from the config', () => {
    assert.equal(doc.title, '概念词条库');
  });
});

describe('searching', () => {
  before(async () => {
    site = await startSite();
    doc = site.dom.window.document;
    DomEvent = site.dom.window.Event;
    input = /** @type {any} */ (doc.querySelector('#q'));
  });

  after(() => {
    site.app.destroy();
  });

  it('filters on a contains match, without letter headings', () => {
    search('物理');
    assert.deepEqual(listed(), ['焓', '熵']);
    assert.equal(doc.querySelectorAll('h2.letter').length, 0);
    assert.match(doc.querySelector('p.count').textContent, /命中 2 条/);
  });

  it('highlights what matched', () => {
    search('焓');
    const marks = [...doc.querySelectorAll('a.term mark')].map((node) => node.textContent);
    assert.ok(marks.includes('焓'));
    assert.equal(doc.querySelectorAll('h2.letter').length, 0);
  });

  it('supports the "=" prefix for an exact match', () => {
    search('=焓');
    assert.deepEqual(listed(), ['焓']);
    search('=焓x');
    assert.equal(listed().length, 0);
  });

  it('matches aliases in exact mode', () => {
    search('=entropy');
    assert.deepEqual(listed(), ['熵']);
  });

  it('supports regular expressions', () => {
    search('/^焓|^熵$/');
    assert.deepEqual(listed(), ['焓', '熵']);
    search('/^enthal/');
    assert.deepEqual(listed(), ['焓']);
  });

  it('reports an invalid regular expression', () => {
    search('/[/');
    assert.equal(listed().length, 0);
    assert.match(doc.querySelector('.search__hint').textContent, /正则表达式无效/);
  });

  it('refuses a catastrophic regular expression instead of freezing', () => {
    search('/(a+)+b/');
    assert.equal(listed().length, 0);
    assert.match(doc.querySelector('.search__hint').textContent, /灾难性回溯/);
  });

  it('scopes a query to a field', () => {
    search('tag:算法');
    assert.deepEqual(listed(), ['Binary Search']);
    search('content:log p');
    assert.deepEqual(listed(), ['熵']);
  });

  it('explains an empty result set', () => {
    search('zzzz');
    assert.equal(listed().length, 0);
    assert.match(doc.querySelector('.empty__title').textContent, /没有匹配/);
  });

  it('returns to the index when the query is cleared', () => {
    search('');
    assert.equal(listed().length, 4);
    assert.equal(doc.querySelectorAll('h2.letter').length, 4);
  });

  it('puts the query in the URL so a search can be shared', () => {
    search('焓');
    assert.match(site.dom.window.location.hash, /^#\/\?q=/);
    search('');
  });

  it('opens the first result when the form is submitted', () => {
    search('=enthalpy');
    fire(doc.querySelector('form.search'), 'submit');
    assert.match(site.dom.window.location.hash, /#\/e\/enthalpy$/);
    assert.equal(doc.querySelector('.entry-title').textContent, '焓');
  });

  it('clears the query with the 清空 button', () => {
    search('焓');
    const clearButton = /** @type {HTMLElement} */ (doc.querySelector('.search__clear'));
    assert.equal(clearButton.hidden, false);
    clearButton.click();
    assert.equal(input.value, '');
    assert.equal(listed().length, 4);
    assert.equal(clearButton.hidden, true);
  });
});

describe('entry pages', () => {
  before(async () => {
    site = await startSite();
    doc = site.dom.window.document;
    DomEvent = site.dom.window.Event;
    input = /** @type {any} */ (doc.querySelector('#q'));
  });

  after(() => {
    site.app.destroy();
  });

  /**
   * @param {string} id
   * @returns {void}
   */
  function openFromIndex(id) {
    const link = /** @type {HTMLElement} */ (doc.querySelector(`a.term[data-id="${id}"]`));
    assert.ok(link, `no index link for ${id}`);
    followLink(link);
  }

  it('navigates from the index to an entry page', () => {
    openFromIndex('entropy');
    assert.equal(doc.querySelector('.entry-title').textContent, '熵');
    assert.match(doc.querySelector('.meta-line').textContent, /别名：/);
    assert.match(doc.querySelector('.summary').textContent, /度量不确定性/);
    assert.ok(doc.querySelector('.crumbs a').getAttribute('href') === '#/');
    assert.match(doc.querySelector('.crumbs').textContent, /更新于 2025-01-02/);
  });

  it('renders the Markdown body, including tables', () => {
    const prose = doc.querySelector('.prose');
    assert.match(prose.innerHTML, /<h3>定义<\/h3>/);
    assert.match(prose.innerHTML, /<table>/);
  });

  it('resolves wiki links and marks unknown ones', () => {
    assert.equal(doc.querySelector('.prose a.term-link').getAttribute('href'), '#/e/enthalpy');
    assert.equal(doc.querySelector('.prose .term-link--missing').textContent, '不存在的词条');
  });

  it('offers previous/next navigation in dictionary order', () => {
    // Dictionary order is B(inary Search) → H(焓) → S(熵) → Z(注入测试),
    // so 熵's neighbours are 焓 and 注入测试.
    const pager = doc.querySelector('.pager');
    assert.match(pager.textContent, /← 焓/);
    assert.match(pager.textContent, /注入测试 →/);
  });

  it('returns to the index with the back link', () => {
    followLink(/** @type {HTMLElement} */ (doc.querySelector('.crumbs a')));
    assert.equal(doc.querySelectorAll('a.term').length, 4);
    assert.match(site.dom.window.location.hash, /^#\/$/);
  });

  it('jumps to another entry by clicking its wiki link', () => {
    openFromIndex('entropy');
    followLink(/** @type {HTMLElement} */ (doc.querySelector('.prose a.term-link')));
    assert.equal(doc.querySelector('.entry-title').textContent, '焓');
  });

  it('shows a helpful page for a link that no longer resolves', () => {
    site.app.openEntry('deleted-entry');
    assert.match(doc.querySelector('.entry-title').textContent, /没有这个词条/);
    assert.match(doc.querySelector('#view').textContent, /deleted-entry/);
  });

  it('navigates into a tag and an alias from the entry page', () => {
    site.app.openEntry('entropy');
    const tagLink = /** @type {HTMLElement} */ (
      [...doc.querySelectorAll('.meta-line a')].find((node) => node.textContent === '物理')
    );
    followLink(tagLink);
    assert.equal(listed().length, 2);
    assert.match(site.dom.window.location.hash, /tag%3A/);
  });

  it('never executes or injects raw HTML from an entry', () => {
    site.dom.window.__XSS__ = false;
    site.app.openEntry('xss');
    const view = doc.querySelector('#view');
    assert.equal(view.querySelector('script'), null);
    assert.equal(view.querySelector('img'), null);
    assert.equal(site.dom.window.__XSS__, false);
    assert.equal(view.querySelector('a[href^="javascript"]'), null);
    assert.match(view.textContent, /危险/);
  });
});

describe('deep links', () => {
  it('restores a shared search from the hash', async () => {
    const local = await startSite({ url: 'https://example.test/ladr/#/?q=%E7%86%B5' });
    const localDoc = local.dom.window.document;
    assert.equal(/** @type {HTMLInputElement} */ (localDoc.querySelector('#q')).value, '熵');
    assert.deepEqual(
      [...localDoc.querySelectorAll('a.term')].map((node) => node.textContent),
      ['熵'],
    );
    local.app.destroy();
  });

  it('opens an entry directly from the hash', async () => {
    const local = await startSite({ url: 'https://example.test/ladr/#/e/enthalpy' });
    assert.equal(local.dom.window.document.querySelector('.entry-title').textContent, '焓');
    local.app.destroy();
  });

  it('ignores an unknown hash and shows the index', async () => {
    const local = await startSite({ url: 'https://example.test/ladr/#/nonsense' });
    assert.equal(local.dom.window.document.querySelectorAll('a.term').length, 4);
    local.app.destroy();
  });
});

describe('failures and shortcuts', () => {
  it('explains a missing data file', async () => {
    const local = await startSite({ failEntries: true });
    const localDoc = local.dom.window.document;
    assert.match(localDoc.querySelector('.status').textContent, /无法读取/);
    assert.equal(localDoc.querySelector('#view').querySelectorAll('a.term').length, 0);
    local.app.destroy();
  });

  it('shows a warning when config.json points at an absolute URL', async () => {
    const local = await startSite({ config: { data: { url: 'https://example.com/entries.json' } } });
    assert.match(local.dom.window.document.querySelector('.status').textContent, /相对路径/);
    local.app.destroy();
  });

  it('focuses the search box with "/" and returns to the index with Escape', async () => {
    const local = await startSite();
    const localDoc = local.dom.window.document;
    DomEvent = local.dom.window.Event;

    localDoc.body.dispatchEvent(new local.dom.window.KeyboardEvent('keydown', { key: '/', bubbles: true }));
    assert.equal(localDoc.activeElement, localDoc.querySelector('#q'));

    local.app.openEntry('entropy');
    assert.equal(localDoc.querySelector('.entry-title').textContent, '熵');
    localDoc.body.dispatchEvent(new local.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(localDoc.querySelectorAll('a.term').length, 4);
    local.app.destroy();
  });
});