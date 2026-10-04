/**
 * Whole-app integration test: the real index.html, the real modules, a real
 * (jsdom) DOM, and a stubbed network. This is the closest thing to "open the
 * page in a browser" that runs in CI.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { boot } from '../web/js/app.js';
import { memoryStorage, response } from './helpers/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Entries used by most tests: two Chinese names, aliases, tags and one XSS attempt. */
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
      content: '## 定义\n\nH(X) = -Σ p log p\n\n见 [[焓]] 与 [[不存在的词条]]\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
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
      content: '<img src=x onerror="window.__XSS__ = true">\n\n<script>window.__XSS__ = true</script>\n\n[危险](javascript:alert(1))',
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
 * @returns {Promise<{dom: JSDOM, app: object, repository: object}>}
 */
async function startApp(options = {}) {
  const html = await fs.readFile(path.join(REPO_ROOT, 'web', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: options.url ?? 'https://example.test/',
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
  const names = [
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
    'customElements',
  ];
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      value: dom.window[name],
      configurable: true,
      writable: true,
    });
  }
}

/**
 * @param {HTMLElement} node
 * @param {string} type
 * @returns {void}
 */
function fire(node, type) {
  node.dispatchEvent(new dom4Event(type, { bubbles: true, cancelable: true }));
}

/** Event constructor of the current jsdom window. */
let dom4Event = /** @type {any} */ (globalThis.Event);

describe('UI - rendering', () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let app;
  /** @type {Document} */
  let doc;

  before(async () => {
    // jsdom is created inside startApp; capture the event constructor it exposes.
    app = await startApp();
    doc = app.dom.window.document;
  });

  after(() => {
    app.app.destroy();
  });

  it('loads entries and renders the A-Z grouped list', () => {
    const items = doc.querySelectorAll('.entry-item');
    assert.equal(items.length, 4);
    const letters = [...doc.querySelectorAll('.entries__letter-text')].map((node) => node.textContent);
    assert.deepEqual(letters, ['B', 'H', 'S', 'Z']); // Binary Search / 焓 hán / 熵 shāng / 注入测试 zhù
  });

  it('shows the total in the stats line', () => {
    assert.match(doc.querySelector('#site-stats').textContent, /共 4 条词条/);
  });

  it('renders the search box and the initials navigation', () => {
    assert.ok(doc.querySelector('#search-input'));
    assert.equal(doc.querySelectorAll('.initials__letter').length, 28);
    assert.ok(!doc.querySelector('.entry-item.is-active'));
  });

  it('shows the placeholder when nothing is selected', () => {
    assert.match(doc.querySelector('.detail').textContent, /选择一个词条/);
  });
});

describe('UI - searching', () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let app;
  /** @type {Document} */
  let doc;
  /** @type {HTMLInputElement} */
  let input;

  before(async () => {
    app = await startApp();
    doc = app.dom.window.document;
    dom4Event = app.dom.window.Event;
    input = /** @type {any} */ (doc.querySelector('#search-input'));
  });

  after(() => {
    app.app.destroy();
  });

  /**
   * @param {string} value
   * @returns {void}
   */
  function type(value) {
    input.value = value;
    fire(input, 'input');
  }

  /**
   * @returns {string[]} Names currently listed.
   */
  function listed() {
    return [...doc.querySelectorAll('.entry-item__name')].map((node) => node.textContent);
  }

  it('filters on contains search', () => {
    type('物理');
    // tag match: both physics entries, ordered by the name collator (hán < shāng)
    assert.deepEqual(listed(), ['焓', '熵']);
  });

  it('highlights the matched part of the name', () => {
    type('熵');
    assert.equal(doc.querySelectorAll('.entry-item__name mark').length, 1);
    assert.equal(doc.querySelector('.entry-item__name mark').textContent, '熵');
  });

  it('switches to exact mode', () => {
    type('熵');
    assert.deepEqual(listed(), ['熵', '焓'].filter((name) => name === '熵'));
    const mode = /** @type {HTMLSelectElement} */ (doc.querySelector('.search__mode'));
    mode.value = 'exact';
    fire(mode, 'change');
    assert.deepEqual(listed(), ['熵']);
    type('ent');
    assert.deepEqual(listed(), []);
    type('entropy'); // exact match against the alias
    assert.deepEqual(listed(), ['熵']);
    mode.value = 'contains';
    fire(mode, 'change');
  });

  it('supports the "=" prefix for exact search', () => {
    type('=焓');
    assert.deepEqual(listed(), ['焓']);
  });

  it('supports regular expressions', () => {
    type('/^焓|^熵$/');
    assert.deepEqual(listed(), ['焓', '熵']);

    // Aliases are matched by a regex too.
    type('/^enthal/');
    assert.deepEqual(listed(), ['焓']);
  });

  it('reports an invalid regular expression', () => {
    type('/[/');
    assert.equal(listed().length, 0);
    assert.match(doc.querySelector('.search__hint').textContent, /正则表达式无效/);
  });

  it('refuses a catastrophic regular expression', () => {
    type('/(a+)+b/');
    assert.equal(listed().length, 0);
    assert.match(doc.querySelector('.search__hint').textContent, /灾难性回溯/);
  });

  it('scopes a query to a field', () => {
    type('tag:算法');
    assert.deepEqual(listed(), ['Binary Search']);
    type('content:log p');
    assert.deepEqual(listed(), ['熵']);
  });

  it('reports that nothing matched', () => {
    type('zzzz');
    assert.equal(listed().length, 0);
    assert.match(doc.querySelector('.entries-empty').textContent, /没有匹配/);
  });

  it('clears the query back to browse mode', () => {
    type('');
    assert.equal(listed().length, 4);
    assert.match(doc.querySelector('.search__hint').textContent, /浏览全部词条/);
  });

  it('shows the query in the URL for sharing', () => {
    type('焓');
    assert.match(app.dom.window.location.hash, /q=%E7%84%93/);
    type('');
  });

  it('filters by initial letter from the navigation bar', () => {
    const letter = /** @type {HTMLButtonElement} */ (
      [...doc.querySelectorAll('.initials__letter')].find((node) => node.textContent === 'B')
    );
    letter.click();
    assert.deepEqual(listed(), ['Binary Search']);
    letter.click(); // toggles back to all
    assert.equal(listed().length, 4);
  });
});

describe('UI - detail view', () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let app;
  /** @type {Document} */
  let doc;

  before(async () => {
    app = await startApp();
    doc = app.dom.window.Event ? app.dom.window.document : app.dom.window.document;
    dom4Event = app.dom.window.Event;
  });

  after(() => {
    app.app.destroy();
  });

  /**
   * @param {string} id
   * @returns {void}
   */
  function select(id) {
    const button = /** @type {HTMLElement} */ (
      doc.querySelector(`.entry-item__button[data-id="${id}"]`)
    );
    button.click();
  }

  it('renders the entry title, aliases, tags and body', () => {
    select('entropy');
    assert.equal(doc.querySelector('.detail__title').textContent, '熵');
    assert.match(doc.querySelector('.detail__aliases').textContent, /entropy/);
    assert.equal(doc.querySelector('.detail__tags .chip').textContent, '物理');
    const content = doc.querySelector('.detail__content');
    assert.match(content.innerHTML, /<h3>定义<\/h3>/);
    assert.match(content.innerHTML, /<table>/);
  });

  it('resolves wiki links to existing entries and marks missing ones', () => {
    select('entropy');
    const link = doc.querySelector('.detail__content a.term-link');
    assert.equal(link.getAttribute('href'), '#/?e=enthalpy');
    assert.equal(doc.querySelector('.detail__content .term-link--missing').textContent, '不存在的词条');
  });

  it('never executes or injects raw HTML from an entry', () => {
    app.dom.window.__XSS__ = false;
    select('xss');
    const content = doc.querySelector('.detail__content');
    assert.equal(content.querySelector('script'), null);
    assert.equal(content.querySelector('img'), null);
    assert.equal(app.dom.window.__XSS__, false);
    // An unsafe URL is not linked; it stays visible as inert text.
    assert.equal(content.querySelector('a[href^="javascript"]'), null);
    assert.match(content.textContent, /危险/);
  });

  it('records the selected entry in the URL', () => {
    select('enthalpy');
    assert.match(app.dom.window.location.hash, /e=enthalpy/);
  });

  it('copies a shareable link', async () => {
    select('enthalpy');
    const copyButton = /** @type {HTMLElement} */ (
      [...doc.querySelectorAll('.detail__actions .button')].find((node) =>
        node.textContent.includes('复制链接'),
      )
    );
    copyButton.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(doc.querySelector('#toasts').textContent.length > 0);
  });

  it('hides the edit actions on a read-only source', () => {
    select('entropy');
    const labels = [...doc.querySelectorAll('.detail__actions .button')].map((node) => node.textContent);
    assert.deepEqual(labels, ['复制链接']);
    assert.match(doc.querySelector('.toolbar__hint').textContent, /只读数据源/);
  });
});

describe('UI - editing', () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let app;
  /** @type {Document} */
  let doc;

  before(async () => {
    app = await startApp();
    doc = app.dom.window.document;
    dom4Event = app.dom.window.Event;
    // Local editing needs no server: switch the source and reload.
    await app.repository.setConfig({ source: 'local' });
    app.app.render();
  });

  after(() => {
    app.app.destroy();
  });

  it('enables the editing UI on a writable source', () => {
    const labels = [...doc.querySelectorAll('.toolbar .button')].map((node) => node.textContent);
    assert.ok(labels.includes('新增词条'));
    assert.equal(doc.querySelector('.toolbar__hint').hidden, true);
  });

  it('creates an entry from the editor', async () => {
    app.app.openCreate();
    const modal = doc.querySelector('.modal');
    assert.ok(modal, 'editor modal should be open');

    const name = /** @type {HTMLInputElement} */ (doc.querySelector('#f-name'));
    name.value = 'Beta 测试';
    const tags = /** @type {HTMLInputElement} */ (doc.querySelector('#f-tags'));
    tags.value = '测试, 演示';
    fire(doc.querySelector('form.editor'), 'input');

    const save = /** @type {HTMLElement} */ (
      [...doc.querySelectorAll('.modal__footer .button')].find((node) => node.textContent === '保存')
    );
    assert.equal(/** @type {HTMLButtonElement} */ (save).disabled, false);
    const before = app.repository.collection.size;
    save.click();
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Local editing starts from a copy of the bundled file, so it grows by one.
    assert.equal(app.repository.collection.size, before + 1);
    assert.equal(app.repository.collection.byName('Beta 测试').tags.length, 2);
    assert.equal(doc.querySelector('.modal'), null);
    assert.match(doc.querySelector('#toasts').textContent, /已新增/);
  });

  it('blocks saving an entry whose name duplicates another one', async () => {
    app.app.openCreate();
    const name = /** @type {HTMLInputElement} */ (doc.querySelector('#f-name'));
    name.value = 'Beta 测试';
    fire(doc.querySelector('form.editor'), 'input');
    const save = /** @type {HTMLButtonElement} */ (
      [...doc.querySelectorAll('.modal__footer .button')].find(
        (node) => node.textContent === '保存',
      )
    );
    assert.equal(save.disabled, true);
    assert.match(doc.querySelector('.editor__issues').textContent, /已存在/);
  });

  it('previews markdown without executing it', () => {
    const content = /** @type {HTMLTextAreaElement} */ (doc.querySelector('#f-content'));
    content.value = '**bold** <script>window.__XSS2__ = true</script>';
    fire(doc.querySelector('form.editor'), 'input');
    const previewTab = /** @type {HTMLElement} */ (
      [...doc.querySelectorAll('.editor__tabs .tab')].find((node) => node.textContent === '预览')
    );
    previewTab.click();
    const preview = doc.querySelector('.editor__preview');
    assert.match(preview.innerHTML, /<strong>bold<\/strong>/);
    assert.ok(!preview.innerHTML.includes('<script>'));
  });

  it('deletes an entry after confirmation', async () => {
    const before = app.repository.collection.size;
    app.app.openEntry(app.repository.collection.entries[0].id);
    const remove = /** @type {HTMLElement} */ (
      [...doc.querySelectorAll('.detail__actions .button')].find((node) => node.textContent === '删除')
    );
    remove.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const confirm = /** @type {HTMLElement} */ (
      [...doc.querySelectorAll('.modal__footer .button')].find((node) => node.textContent === '删除')
    );
    confirm.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(app.repository.collection.size, before - 1);
  });
});

describe('UI - settings dialog', () => {
  it('offers all four data sources by default', async () => {
    const app = await startApp();
    const doc = app.dom.window.document;
    const tools = [...doc.querySelectorAll('.toolbar .button')].find((node) => node.textContent === '设置');
    /** @type {HTMLElement} */ (tools).click();
    const labels = [...doc.querySelectorAll('.settings__source-label')].map((node) => node.textContent);
    assert.deepEqual(labels, ['静态 JSON（只读）', '本地编辑（仅此设备）', 'GitHub 仓库（可写）', '自建后端（可写）']);
    assert.equal(doc.querySelector('.modal').textContent.includes('数据源设置'), true);
    app.app.destroy();
  });

  it('hides local editing when config.json disallows it', async () => {
    const app = await startApp({ config: { allowLocalEditing: false } });
    const doc = app.dom.window.document;
    const button = [...doc.querySelectorAll('.toolbar .button')].find((node) => node.textContent === '设置');
    /** @type {HTMLElement} */ (button).click();
    const labels = [...doc.querySelectorAll('.settings__source-label')].map((node) => node.textContent);
    assert.ok(!labels.includes('本地编辑（仅此设备）'));
    assert.equal(labels.length, 3);
    app.app.destroy();
  });
});

describe('UI - deep links and failures', () => {
  it('restores a shared query from the URL hash', async () => {
    const app = await startApp({ url: 'https://example.test/#/?q=%E7%84%93&mode=contains' });
    const doc = app.dom.window.document;
    assert.equal(/** @type {HTMLInputElement} */ (doc.querySelector('#search-input')).value, '焓');
    // "焓" also appears inside other entries' bodies, so full-text search finds them too.
    assert.deepEqual(
      [...doc.querySelectorAll('.entry-item__name')].map((node) => node.textContent),
      ['焓', '熵', 'Binary Search'],
    );
    app.app.destroy();
  });

  it('opens an entry directly from the URL', async () => {
    const app = await startApp({ url: 'https://example.test/#/?e=enthalpy' });
    const doc = app.dom.window.document;
    assert.equal(doc.querySelector('.detail__title').textContent, '焓');
    app.app.destroy();
  });

  it('shows a banner with a hint when the data source is unreachable', async () => {
    const app = await startApp({ failEntries: true });
    const doc = app.dom.window.document;
    const banner = doc.querySelector('#app-banner');
    assert.equal(banner.hidden, false);
    assert.match(banner.textContent, /无法连接数据源|CORS/);
    assert.match(doc.querySelector('#list-host').textContent, /暂无词条/);
    app.app.destroy();
  });
});

describe('UI - keyboard shortcuts', () => {
  it('focuses the search box on "/" and opens the editor on "n"', async () => {
    const app = await startApp();
    const doc = app.dom.window.document;
    dom4Event = app.dom.window.Event;

    doc.body.dispatchEvent(
      new app.dom.window.KeyboardEvent('keydown', { key: '/', bubbles: true }),
    );
    assert.equal(doc.activeElement, doc.querySelector('#search-input'));

    await app.repository.setConfig({ source: 'local' });
    doc.body.dispatchEvent(new app.dom.window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    assert.ok(doc.querySelector('.modal'), 'editor should open on "n"');
    app.app.destroy();
  });
});