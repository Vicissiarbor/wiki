/**
 * Application entry point: the composition root.
 *
 * Wiring only — configuration, repository, views and keyboard shortcuts are
 * assembled here, while every rule lives in the core modules. Keeping this file
 * free of business logic is what makes the rest unit-testable.
 */

import { createEntry } from './core/entry.js';
import { describeError } from './core/errors.js';
import { initialOfEntry } from './core/initials.js';
import { SearchMode, describeQuery, searchEntries } from './core/search.js';
import { groupEntriesByInitial } from './core/sort.js';
import { loadConfig, writeOverrides } from './config.js';
import { EntryRepository } from './data/repository.js';
import { createStorage } from './util/storage.js';
import { debounce } from './util/timing.js';
import { el, fragment, qs } from './ui/dom.js';
import { createEntryDetail } from './ui/entry-detail.js';
import { createEntryEditor } from './ui/entry-editor.js';
import { createEntryList } from './ui/entry-list.js';
import { createInitialsNav } from './ui/initials-nav.js';
import { confirmDialog } from './ui/modal.js';
import { createRouter, parseHash } from './ui/router.js';
import { createSearchPanel } from './ui/search-panel.js';
import { createSettingsPanel } from './ui/settings-panel.js';
import { copyText, toast, toastError, toastSuccess } from './ui/toast.js';

/** Element ids the HTML shell must provide (see web/index.html). */
const SHELL = {
  title: '#site-title',
  subtitle: '#site-subtitle',
  stats: '#site-stats',
  banner: '#app-banner',
  search: '#search-host',
  initials: '#initials-host',
  list: '#list-host',
  detail: '#detail-host',
  toolbar: '#toolbar-host',
};

/**
 * Boot the app against a document (defaults to the real browser document).
 *
 * Exported so the test suite can mount the whole UI in jsdom.
 *
 * @param {{root?: Document, fetchImpl?: typeof fetch, storage?: object, win?: Window,
 *   configUrl?: string}} [options]
 * @returns {Promise<{app: object, repository: EntryRepository,
 *   config: import('./config.js').AppConfig, view: object}>}
 */
export async function boot(options = {}) {
  const root = options.root ?? document;
  const win = options.win ?? window;
  const storage = options.storage ?? createStorage('ladr');

  const { config, warnings } = await loadConfig({
    storage,
    fetchImpl: options.fetchImpl,
    configUrl: options.configUrl,
  });

  const repository = new EntryRepository({
    config,
    storage,
    fetchImpl: options.fetchImpl,
    warnings,
  });

  /** @type {Record<keyof typeof SHELL, HTMLElement>} */
  const shell = collectShell(root);
  /** Initial letters are derived once per entry object. */
  const initialCache = new WeakMap();

  /** UI state (not data): current query, filters and selection. */
  const state = {
    query: '',
    mode: /** @type {import('./core/search.js').SearchMode} */ (config.search.mode) || SearchMode.CONTAINS,
    activeLetter: '',
    activeId: '',
    limit: config.search.pageSize,
    /** @type {import('./core/search.js').SearchOutcome|null} */
    outcome: null,
    repositoryState: repository.state,
  };

  // ---------------------------------------------------------------- views --

  const searchPanel = createSearchPanel({
    onInput: (value) => setQuery(value),
    onModeChange: (mode) => {
      state.mode = mode;
      render();
    },
    onSubmit: () => {
      const first = state.outcome?.results?.[0]?.entry.id;
      if (first) {
        openEntry(first);
      }
    },
  });
  shell.search.appendChild(searchPanel.element);

  const initialsNav = createInitialsNav({
    onSelect: (letter) => {
      state.activeLetter = state.activeLetter === letter ? '' : letter;
      state.limit = config.search.pageSize;
      render();
    },
  });
  shell.initials.appendChild(initialsNav.element);

  const entryList = createEntryList({
    onSelect: (id) => openEntry(id),
    onLoadMore: () => {
      state.limit += config.search.pageSize;
      render();
    },
  });
  shell.list.appendChild(entryList.element);

  const entryDetail = createEntryDetail({
    onEdit: (entry) => editor.openEdit(entry),
    onDelete: (entry) => removeEntry(entry),
    onCopyLink: (entry) => copyEntryLink(entry),
    onTagClick: (term) => setQuery(term),
    onNavigate: (id) => openEntry(id),
  });
  shell.detail.appendChild(entryDetail.element);

  const editor = createEntryEditor({
    getCollection: () => repository.collection,
    onSave: async (entry) => {
      const taken = new Set(repository.collection.ids());
      const complete = entry.id === '' ? createEntry(entry, { taken }) : entry;
      await repository.saveEntry(complete);
      state.activeId = complete.id;
      render();
    },
    onDelete: async (entry) => {
      await repository.deleteEntry(entry.id);
      if (state.activeId === entry.id) {
        state.activeId = '';
      }
      render();
    },
  });

  const settings = createSettingsPanel({
    config,
    getStatus: () => ({
      origin: repository.state.origin,
      revision: repository.state.revision,
      fetchedAt: repository.state.fetchedAt,
      writable: repository.state.writable,
      error: repository.state.error,
      errorKind: repository.state.errorKind,
      issues: repository.state.issues,
    }),
    onApply: async (patch) => {
      writeOverrides(storage, patch);
      await repository.setConfig(patch);
      render();
    },
    onReset: async () => {
      storage.remove('settings.v1');
      win.location.reload();
    },
    onExportAll: () => exportAll(),
    onImportAll: async (raw) => {
      await repository.importDocument(raw);
      render();
    },
  });

  const router = createRouter({
    win,
    onChange: (route) => {
      if (route.query !== state.query) {
        state.query = route.query;
        searchPanel.setValue(route.query);
      }
      if (route.mode && route.mode !== state.mode) {
        state.mode = /** @type {any} */ (route.mode);
      }
      state.activeLetter = route.letter;
      state.activeId = route.entryId;
      render();
    },
  });

  const toolbar = buildToolbar({
    onAdd: () => openCreate(),
    onRefresh: () => refreshNow(),
    onSettings: () => settings.open(),
    onExport: () => exportAll(),
  });
  shell.toolbar.appendChild(toolbar.element);

  // -------------------------------------------------------------- actions --

  const debouncedRender = debounce(() => render(), 90, { maxWaitMs: 260 });

  /**
   * @param {string} value
   */
  function setQuery(value) {
    state.query = value;
    state.limit = config.search.pageSize;
    state.activeLetter = '';
    searchPanel.setValue(value);
    render();
    debouncedRender.cancel();
  }

  /**
   * @param {string} id
   */
  function openEntry(id) {
    state.activeId = id;
    render();
    shell.detail?.scrollIntoView?.({ block: 'nearest' });
  }

  function openCreate() {
    if (!repository.state.writable) {
      toast('当前数据源是只读的：请打开“设置”，切换到“本地编辑 / GitHub 仓库 / 自建后端”后再新增。', {
        tone: 'warning',
        durationMs: 6000,
      });
      return;
    }
    const seedName = state.query.startsWith('=') ? state.query.slice(1) : '';
    editor.openCreate({ name: seedName });
  }

  /**
   * @param {object} entry
   */
  async function removeEntry(entry) {
    const confirmed = await confirmDialog({
      title: `删除「${entry.name}」？`,
      message: '删除后需要重新添加。只读数据源无法删除。确定继续吗？',
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await repository.deleteEntry(entry.id);
      if (state.activeId === entry.id) {
        state.activeId = '';
      }
      toastSuccess(`已删除「${entry.name}」`);
      render();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  /**
   * @param {object} entry
   */
  async function copyEntryLink(entry) {
    const link = router.buildLink({
      query: state.query,
      mode: state.mode,
      letter: state.activeLetter,
      entryId: entry.id,
    });
    const ok = await copyText(link);
    if (ok) {
      toastSuccess('链接已复制，可在手机上直接打开该词条');
    } else {
      toastError('复制失败，请从地址栏复制链接');
    }
  }

  function exportAll() {
    const document = repository.exportDocument();
    const text = `${JSON.stringify(document, null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const anchor = el('a', { href: url, download: 'entries.json', style: { display: 'none' } });
    root.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${document.entries.length} 条词条（entries.json）`, { tone: 'success' });
  }

  async function refreshNow() {
    await repository.refresh({ refresh: true });
    render();
    if (repository.state.error === '') {
      toast('已从数据源重新加载', { tone: 'success' });
    } else {
      toastError(repository.state.error);
    }
  }

  // -------------------------------------------------------------- helpers --

  /**
   * @param {import('./core/entry.js').Entry} entry
   * @returns {string} Bucket letter of an entry (memoized per entry object).
   */
  function initialLetter(entry) {
    let letter = initialCache.get(entry);
    if (letter === undefined) {
      letter = initialOfEntry(entry);
      initialCache.set(entry, letter);
    }
    return letter;
  }

  // ------------------------------------------------------------- rendering --

  function render() {
    const rs = state.repositoryState;
    const entries = rs.collection.entries;
    const scoped = state.activeLetter
      ? entries.filter((entry) => initialLetter(entry) === state.activeLetter)
      : entries;

    const outcome = searchEntries(scoped, state.query, {
      mode: state.mode,
      budgetMs: config.search.budgetMs,
      maxResults: config.search.maxResults,
    });
    state.outcome = outcome;

    const isBrowsing = outcome.parsed.isEmpty;
    /** @type {Array<{type: string, letter?: string, entry?: object, score?: number, fields?: string[]}>} */
    const rows = [];
    if (isBrowsing) {
      for (const group of groupEntriesByInitial(scoped)) {
        rows.push({ type: 'letter', letter: group.letter });
        for (const entry of group.entries) {
          rows.push({ type: 'entry', entry, score: 0, fields: [] });
        }
      }
    } else {
      for (const result of outcome.results) {
        rows.push({ type: 'entry', entry: result.entry, score: result.score, fields: result.fields });
      }
    }
    const shown = rows.filter((row) => row.type === 'entry').length;

    searchPanel.setMode(state.mode);
    searchPanel.setHint(
      hintText(outcome, shown, scoped.length),
      outcome.error === '' ? 'info' : 'warning',
    );
    initialsNav.update(entries, state.activeLetter);
    entryList.update({
      rows,
      parsed: outcome.parsed,
      activeId: state.activeId,
      limit: state.limit,
      totalEntries: entries.length,
      showLoadMore: shown > state.limit,
      emptyMessage: isBrowsing
        ? state.activeLetter
          ? `没有以 ${state.activeLetter} 开头的词条。`
          : '暂无词条。'
        : `没有匹配「${outcome.parsed.raw}」的词条。`,
    });
    entryDetail.update({
      entry: rs.collection.byId(state.activeId),
      collection: rs.collection,
      parsed: outcome.parsed,
      writable: rs.writable,
      totalEntries: entries.length,
    });
    renderStats(shell.stats, entries.length, outcome, rs);
    renderBanner(shell.banner, rs, { onRetry: () => refreshNow(), onSettings: () => settings.open() });
    toolbar.update(rs);
    router.sync({
      query: state.query,
      mode: state.mode,
      letter: state.activeLetter,
      entryId: state.activeId,
    });
  }

  // ------------------------------------------------------------- shortcuts --

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
      searchPanel.focus();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchPanel.focus();
      return;
    }
    if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openCreate();
    }
  }

  // ------------------------------------------------------------------ boot --

  repository.subscribe((rs) => {
    if (rs.sourceId !== state.repositoryState.sourceId) {
      state.activeId = '';
    }
    state.repositoryState = rs;
    // Only drop the selection once the data has actually arrived: a deep link
    // (`#/?e=…`) is resolved during the first loading state, when the
    // collection is still empty.
    if (rs.status === 'ready' && state.activeId && !rs.collection.byId(state.activeId)) {
      state.activeId = '';
    }
    render();
  });

  applySiteHeader(root, config);
  router.start();
  root.addEventListener('keydown', /** @type {EventListener} */ (onKeyDown));

  const initialRoute = parseHash(win.location?.hash ?? '');
  state.query = initialRoute.query;
  state.activeLetter = initialRoute.letter;
  state.activeId = initialRoute.entryId;
  if (initialRoute.mode) {
    state.mode = /** @type {any} */ (initialRoute.mode);
  }
  searchPanel.setValue(state.query);
  render();

  await repository.init();
  render();

  for (const warning of warnings) {
    toast(warning, { tone: 'warning', durationMs: 8000 });
  }

  const app = {
    state,
    render,
    setQuery,
    openEntry,
    openCreate,
    refreshNow,
    exportAll,
    destroy() {
      router.stop();
      root.removeEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
    },
  };

  return { app, repository, config, view: { searchPanel, initialsNav, entryList, entryDetail } };
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
 * @returns {void}
 */
function applySiteHeader(root, config) {
  const title = qs(SHELL.title, root);
  const subtitle = qs(SHELL.subtitle, root);
  if (title) {
    title.textContent = config.site.title;
  }
  if (subtitle) {
    subtitle.textContent = config.site.subtitle;
  }
  if (root.title !== undefined) {
    root.title = `${config.site.title} · 词条查询`;
  }
}

/**
 * @param {{onAdd: Function, onRefresh: Function, onSettings: Function, onExport: Function}} handlers
 * @returns {{element: HTMLElement, update: (state: object) => void}}
 */
function buildToolbar(handlers) {
  const add = el('button.button.primary', {
    type: 'button',
    text: '新增词条',
    title: '新增一个词条（快捷键 n）',
    on: { click: () => handlers.onAdd() },
  });
  const refresh = el('button.button', {
    type: 'button',
    text: '刷新',
    title: '从数据源重新读取',
    on: { click: () => handlers.onRefresh() },
  });
  const exportButton = el('button.button', {
    type: 'button',
    text: '导出 JSON',
    title: '下载全部词条，便于提交到仓库或备份',
    on: { click: () => handlers.onExport() },
  });
  const settingsButton = el('button.button', {
    type: 'button',
    text: '设置',
    title: '数据源与访问令牌设置',
    on: { click: () => handlers.onSettings() },
  });
  const readOnlyHint = el('span.toolbar__hint', { hidden: true });

  return {
    element: el('div.toolbar', {}, [add, refresh, exportButton, settingsButton, readOnlyHint]),
    update(state) {
      refresh.disabled = state.status === 'loading';
      readOnlyHint.hidden = state.writable;
      readOnlyHint.textContent = state.writable ? '' : '只读数据源';
      readOnlyHint.dataset.source = state.sourceId;
    },
  };
}

/**
 * @param {HTMLElement} host
 * @param {number} total
 * @param {import('./core/search.js').SearchOutcome} outcome
 * @param {object} repositoryState
 * @returns {void}
 */
function renderStats(host, total, outcome, repositoryState) {
  const parts = [`共 ${total} 条词条`];
  if (!outcome.parsed.isEmpty) {
    parts.push(`匹配 ${outcome.results.length} 条`);
    parts.push(`${outcome.elapsedMs.toFixed(1)} ms`);
  }
  if (repositoryState.stale) {
    parts.push('缓存内容，正在刷新…');
  }
  host.replaceChildren(fragment(parts.map((text) => el('span.stats__item', { text }))));
}

/**
 * @param {import('./core/search.js').SearchOutcome} outcome
 * @param {number} shown
 * @param {number} scoped
 * @returns {string}
 */
function hintText(outcome, shown, scoped) {
  if (outcome.error !== '') {
    return outcome.error;
  }
  const base = describeQuery(outcome.parsed);
  if (outcome.parsed.isEmpty) {
    return `${base} · 共 ${scoped} 条`;
  }
  const truncated = outcome.truncated ? '（结果已截断）' : '';
  return `${base} · 命中 ${outcome.results.length} 条，显示 ${Math.min(shown, outcome.results.length)} 条${truncated}`;
}

/**
 * @param {HTMLElement} host
 * @param {object} state
 * @param {{onRetry: () => void, onSettings: () => void}} handlers
 * @returns {void}
 */
function renderBanner(host, state, handlers) {
  if (state.error === '') {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  const hints = {
    'mixed-content':
      '页面是 HTTPS，数据源是 HTTP：浏览器会拦截该请求。请给后端配置 HTTPS，或直接用后端地址打开本站。',
    auth: '令牌缺失或无效：打开“设置”填写访问令牌。',
    network: '无法连接数据源：检查地址、网络，以及服务端的 CORS 设置。',
    missing: '找不到词条文件：确认已提交 web/data/entries.json。',
    'read-only': '当前数据源只读，无法保存修改。',
  };
  host.hidden = false;
  host.replaceChildren(
    fragment([
      el('span.banner__text', { text: state.error }),
      hints[state.errorKind] ? el('span.banner__hint', { text: hints[state.errorKind] }) : null,
      el('button.button.button--ghost', {
        type: 'button',
        text: '重试',
        on: { click: () => handlers.onRetry() },
      }),
      el('button.button.button--ghost', {
        type: 'button',
        text: '打开设置',
        on: { click: () => handlers.onSettings() },
      }),
    ]),
  );
}