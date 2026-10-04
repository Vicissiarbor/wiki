/**
 * Composition root: wiring only.
 *
 * Reads the entries file, renders either the index or the entry page, keeps the
 * address bar in sync, and forwards the couple of keyboard shortcuts that make
 * a dictionary pleasant to use.
 */

import { describeQuery, parseQuery, searchEntries } from './core/search.js';
import { groupEntriesByInitial, sortEntries } from './core/sort.js';
import { loadConfig } from './config.js';
import { createEntriesStore } from './data/entries-store.js';
import { createStorage } from './util/storage.js';
import { el, qs } from './ui/dom.js';
import { renderEntry, renderMissingEntry } from './ui/entry-view.js';
import { renderIndex } from './ui/index-view.js';
import { INDEX_ROUTE, createRouter, parseHash } from './ui/router.js';
import { createSearchBox } from './ui/search-box.js';
import { createStatus } from './ui/status.js';

/** Elements the HTML shell must provide (see web/index.html). */
const SHELL = {
  title: '#site-title',
  tagline: '#site-tagline',
  search: '#search-host',
  status: '#status-host',
  view: '#view',
  footer: '#site-footer',
};

/**
 * Boot the site against a document (defaults to the real browser document).
 *
 * @param {{root?: Document, win?: Window, storage?: object, fetchImpl?: typeof fetch,
 *   configUrl?: string}} [options]
 * @returns {Promise<{app: object, store: object, config: object}>}
 */
export async function boot(options = {}) {
  const root = options.root ?? document;
  const win = options.win ?? window;
  const storage = options.storage ?? createStorage('ladr');

  const { config, warnings } = await loadConfig({
    fetchImpl: options.fetchImpl,
    configUrl: options.configUrl,
  });

  const store = createEntriesStore({
    url: config.data.url,
    storage,
    fetchImpl: options.fetchImpl,
    timeoutMs: config.data.timeoutMs,
  });

  /** @type {Record<keyof typeof SHELL, HTMLElement>} */
  const shell = collectShell(root);

  applyStaticText(root, config, shell);

  /** @type {{route: import('./ui/router.js').Route}} */
  const state = { route: { ...INDEX_ROUTE } };
  /** Result of the most recent index search, reused when the form is submitted. */
  /** @type {import('./core/search.js').SearchOutcome|null} */
  let lastIndexOutcome = null;

  const searchBox = createSearchBox({
    onInput: (value) => setQuery(value),
    onSubmit: () => {
      const first = lastIndexOutcome?.results?.[0]?.entry.id;
      if (first) {
        openEntry(first);
      }
    },
    onClear: () => setQuery(''),
  });
  shell.search.appendChild(searchBox.element);

  const status = createStatus();
  shell.status.appendChild(status.element);

  const router = createRouter({
    win,
    onChange: (route) => {
      state.route = route;
      searchBox.setValue(route.query);
      render();
    },
  });

  // ------------------------------------------------------------- actions --

  /**
   * @param {string} value
   */
  function setQuery(value) {
    state.route = { view: 'index', entryId: '', query: value };
    // Rendering is synchronous: the result list is capped, so a keystroke stays
    // well under a frame even for a few thousand entries.
    render();
  }

  /**
   * @param {string} id
   */
  function openEntry(id) {
    state.route = { view: 'entry', entryId: id, query: '' };
    searchBox.setValue('');
    render();
    scrollToTop();
  }

  /**
   * Start an entry page at the top. Setting `scrollTop` on the scrolling element
   * works everywhere (and unlike `window.scrollTo` it is not a jsdom stub that
   * logs "Not implemented" during tests).
   */
  function scrollToTop() {
    const scroller = root.scrollingElement ?? root.documentElement;
    if (scroller) {
      scroller.scrollTop = 0;
    }
  }

  // ------------------------------------------------------------ rendering --

  function render() {
    const entriesState = store.getState();
    const collection = entriesState.collection;

    if (state.route.view === 'entry') {
      renderEntryPage(collection);
    } else {
      renderIndexPage(collection);
    }

    renderStatus(entriesState);
    renderFooter(collection, entriesState);
    router.sync(state.route);
  }

  /**
   * @param {object} collection
   */
  function renderEntryPage(collection) {
    const entry = collection.byId(state.route.entryId);
    if (!entry) {
      shell.view.replaceChildren(renderMissingEntry(state.route.entryId));
      searchBox.setHint('没有找到这个词条。按 Esc 或点“索引”返回列表。');
      return;
    }
    const ordered = sortEntries(collection.entries);
    const index = ordered.findIndex((item) => item.id === entry.id);
    shell.view.replaceChildren(
      renderEntry({
        entry,
        collection,
        parsed: parseQuery(''),
        previous: index > 0 ? ordered[index - 1] : null,
        next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
        updatedLabel: config.site.updatedLabel,
      }),
    );
    searchBox.setHint('输入名称可以继续查询（=精确 / /正则/），按 Esc 返回索引。');
  }

  /**
   * @param {object} collection
   */
  function renderIndexPage(collection) {
    const outcome = searchEntries(collection.entries, state.route.query, {
      budgetMs: config.search.budgetMs,
      maxResults: config.search.maxResults,
    });
    lastIndexOutcome = outcome;
    const searching = !outcome.parsed.isEmpty;
    const list = searching
      ? outcome.results.map((hit) => hit.entry)
      : null;

    /** @type {Array<{letter: string, entries: Array<object>}>} */
    const groups = searching
      ? [{ letter: '', entries: list ?? [] }]
      : groupEntriesByInitial(collection.entries);

    const matched = searching ? outcome.results.length : collection.size;
    let rendered = 0;
    const limited = groups.map((group) => {
      const room = Math.max(0, config.search.maxResults - rendered);
      const entries = group.entries.slice(0, room);
      rendered += entries.length;
      return { letter: group.letter, entries };
    });

    shell.view.replaceChildren(
      renderIndex({
        groups: limited,
        parsed: outcome.parsed,
        total: collection.size,
        matched,
        rendered,
        truncated: outcome.truncated || rendered < matched,
        emptyTitle: searching
          ? `没有匹配「${outcome.parsed.raw}」的词条。`
          : collection.isEmpty
            ? '还没有任何词条。'
            : '索引是空的。',
        emptyHint: searching
          ? '可以试试包含匹配（直接输入）、=精确匹配，或 /正则/ 写法。'
          : '把词条写进 data/entries.json 并提交，索引会自动更新。',
      }),
    );

    searchBox.setHint(
      outcome.error !== '' ? outcome.error : `${describeQuery(outcome.parsed)} · 共 ${matched} 条`,
      outcome.error !== '' ? 'warning' : 'info',
    );
  }

  /**
   * @param {import('./data/entries-store.js').EntriesState} entriesState
   */
  function renderStatus(entriesState) {
    if (entriesState.error !== '') {
      const hints = {
        missing: '确认 data/entries.json 已提交到仓库（大小写敏感）。',
        format: '用 npm test 或 node -e "JSON.parse(...)" 检查该文件的 JSON 语法。',
        http: '如果刚刚发布，等 GitHub Pages 重建完成后再刷新。',
      };
      status.update({
        message: `${entriesState.error}${hints[entriesState.errorKind] ? ` ${hints[entriesState.errorKind]}` : ''}`,
        tone: 'error',
      });
      return;
    }
    if (warnings.length > 0) {
      status.update({ message: warnings[0], tone: 'warning' });
      return;
    }
    if (entriesState.stale || entriesState.status === 'loading') {
      status.update({ message: '正在读取词条…', tone: 'info' });
      return;
    }
    if (entriesState.issues.length > 0) {
      status.update({
        message: `有 ${entriesState.issues.length} 条词条格式不对，已跳过：${entriesState.issues[0].message}`,
        tone: 'warning',
      });
      return;
    }
    status.clear();
  }

  /**
   * @param {object} collection
   * @param {import('./data/entries-store.js').EntriesState} entriesState
   */
  function renderFooter(collection, entriesState) {
    const parts = [`共 ${collection.size} 条`];
    if (collection.updatedAt) {
      parts.push(`${config.site.updatedLabel} ${String(collection.updatedAt).slice(0, 10)}`);
    }
    if (entriesState.fetchedAt && entriesState.fromCache) {
      parts.push('显示本地缓存');
    }
    shell.footer.replaceChildren(
      el('p', { text: parts.join(' · ') }),
      config.site.footer ? el('p.footer__note', { text: config.site.footer }) : null,
    );
  }

  // ------------------------------------------------------------ shortcuts --

  /**
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable === true;

    if (!typing && event.key === '/') {
      event.preventDefault();
      searchBox.focus();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchBox.focus();
      return;
    }
    if (event.key === 'Escape' && !typing && state.route.view === 'entry') {
      event.preventDefault();
      openEntryBack();
    }
  }

  function openEntryBack() {
    state.route = { ...INDEX_ROUTE };
    searchBox.setValue('');
    render();
  }

  // ----------------------------------------------------------------- boot --

  store.subscribe(() => render());
  router.start();
  root.addEventListener('keydown', /** @type {EventListener} */ (onKeyDown));

  // Restore a shared link before the first paint.
  const initial = parseHash(win.location?.hash ?? '');
  state.route = initial;
  searchBox.setValue(initial.query);
  render();

  await store.load();
  render();

  const app = {
    state,
    render,
    setQuery,
    openEntry,
    openEntryBack,
    store,
    destroy() {
      router.stop();
      root.removeEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
    },
  };
  return { app, store, config };
}

/**
 * @param {Document} root
 * @returns {Record<keyof typeof SHELL, HTMLElement>}
 */
function collectShell(root) {
  /** @type {Record<string, HTMLElement>} */
  const found = {};
  for (const [key, selector] of Object.entries(SHELL)) {
    const node = qs(selector, root);
    if (node === null) {
      throw new Error(`页面缺少必需的元素 ${selector}`);
    }
    found[key] = node;
  }
  return /** @type {Record<keyof typeof SHELL, HTMLElement>} */ (found);
}

/**
 * @param {Document} root
 * @param {import('./config.js').AppConfig} config
 * @param {Record<keyof typeof SHELL, HTMLElement>} shell
 * @returns {void}
 */
function applyStaticText(root, config, shell) {
  shell.title.textContent = config.site.title;
  shell.tagline.textContent = config.site.tagline;
  shell.tagline.hidden = config.site.tagline === '';
  if (root.title !== undefined) {
    root.title = config.site.title;
  }
}