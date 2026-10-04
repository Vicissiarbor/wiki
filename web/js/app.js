/**
 * Composition root: wiring only.
 *
 * Reads the entries file, renders either the index or the entry page, keeps the
 * address bar in sync, and forwards the couple of keyboard shortcuts that make
 * a dictionary pleasant to use.
 */

import { createTranslator } from './core/i18n.js';
import {
  DEFAULT_LOCALE,
  localizeEntries,
  localizeEntry,
  localizedText,
  localeTag,
  normalizeLocale,
} from './core/locale.js';
import { describeQuery, parseQuery, searchEntries } from './core/search.js';
import { createNameCollator, groupEntriesByInitial, sortEntries } from './core/sort.js';
import { loadConfig } from './config.js';
import { createEntriesStore } from './data/entries-store.js';
import { createStorage } from './util/storage.js';
import { el, qs } from './ui/dom.js';
import { renderEntry, renderMissingEntry } from './ui/entry-view.js';
import { renderIndex } from './ui/index-view.js';
import { createLanguageSwitch } from './ui/language-switch.js';
import { renderMath } from './ui/math.js';
import { INDEX_ROUTE, createRouter, parseHash } from './ui/router.js';
import { createSearchBox } from './ui/search-box.js';
import { createStatus } from './ui/status.js';

/** localStorage key holding the chosen interface language. */
const LOCALE_KEY = 'locale';

/** Elements the HTML shell must provide (see web/index.html). */
const SHELL = {
  title: '#site-title',
  tagline: '#site-tagline',
  lang: '#lang-host',
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

  /**
   * The interface language: remembered per device, defaulting to config.json.
   * Switching it re-renders every part of the page (header, search box, index,
   * entry page, footer, status line) — see render().
   */
  const defaultLocale = normalizeLocale(config.site.defaultLocale, DEFAULT_LOCALE);
  let locale = normalizeLocale(storage.get(LOCALE_KEY, defaultLocale), defaultLocale);
  let t = createTranslator(locale);
  // Chinese names sort by pinyin, English names by the English collator.
  let collator = createLocaleCollator(locale);

  const store = createEntriesStore({
    url: config.data.url,
    storage,
    fetchImpl: options.fetchImpl,
    timeoutMs: config.data.timeoutMs,
    t: (key, params) => t(key, params),
  });

  /** @type {Record<keyof typeof SHELL, HTMLElement>} */
  const shell = collectShell(root);

  applyLocale(shell, config, locale, root);

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

  const languageSwitch = createLanguageSwitch({
    t: (key) => t(key),
    onSelect: (next) => setLocale(next),
  });
  shell.lang.appendChild(languageSwitch.element);

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
   * Switch the interface language; everything re-renders from the new strings.
   *
   * @param {string} next
   */
  function setLocale(next) {
    const resolved = normalizeLocale(next, defaultLocale);
    if (resolved === locale) {
      return;
    }
    locale = resolved;
    t = createTranslator(locale);
    collator = createLocaleCollator(locale);
    storage.set(LOCALE_KEY, locale);
    render();
  }

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

    applyLocale(shell, config, locale);
    searchBox.setLabels(t);
    languageSwitch.update(locale);
    renderStatus(entriesState);
    renderFooter(collection, entriesState);
    router.sync(state.route);
  }

  /**
   * @param {object} collection
   */
  function renderEntryPage(collection) {
    const source = collection.byId(state.route.entryId);
    if (!source) {
      shell.view.replaceChildren(renderMissingEntry(state.route.entryId, t));
      searchBox.setHint(t('hint.missingEntry'));
      return;
    }
    const entry = localizeEntry(source, locale);
    const ordered = sortEntries(localizeEntries(collection.entries, locale), {
      compare: collator.compare,
    });
    const index = ordered.findIndex((item) => item.id === entry.id);
    shell.view.replaceChildren(
      renderEntry({
        entry,
        collection,
        parsed: parseQuery('', { t }),
        previous: index > 0 ? ordered[index - 1] : null,
        next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
        updatedLabel: localizedText(config.site.updatedLabel, locale, 'Updated'),
        t,
      }),
    );
    searchBox.setHint(t('hint.entryPage'));
    // KaTeX is fetched on demand, and only for pages that actually show a formula.
    void renderMath(shell.view).catch((error) => {
      console.warn('[SearchLADR] 公式渲染初始化失败', error);
    });
  }

  /**
   * @param {object} collection
   */
  function renderIndexPage(collection) {
    // Search covers both languages; only the display is localized.
    const outcome = searchEntries(collection.entries, state.route.query, {
      budgetMs: config.search.budgetMs,
      maxResults: config.search.maxResults,
      collator,
      t,
    });
    lastIndexOutcome = outcome;
    const searching = !outcome.parsed.isEmpty;
    const list = searching
      ? outcome.results.map((hit) => localizeEntry(hit.entry, locale))
      : null;

    // Localize *first*, so the bucket letter comes from the displayed name
    // (熵 → S in Chinese, Entropy → E in English).
    const displayEntries = localizeEntries(collection.entries, locale);

    /** @type {Array<{letter: string, entries: Array<object>}>} */
    const groups = searching
      ? [{ letter: '', entries: list ?? [] }]
      : groupEntriesByInitial(displayEntries, { compare: collator.compare });

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
        t,
        emptyTitle: searching
          ? t('empty.noMatch', { query: outcome.parsed.raw })
          : collection.isEmpty
            ? t('empty.noEntries')
            : t('empty.noEntries'),
        emptyHint: searching ? t('empty.hintSearch') : t('empty.hintData'),
      }),
    );

    const countText = outcome.parsed.isEmpty
      ? t('count.total', { count: matched })
      : t('count.matched', { count: matched });
    searchBox.setHint(
      outcome.error !== '' ? outcome.error : `${describeQuery(outcome.parsed, t)} · ${countText}`,
      outcome.error !== '' ? 'warning' : 'info',
    );
  }

  /**
   * @param {import('./data/entries-store.js').EntriesState} entriesState
   */
  function renderStatus(entriesState) {
    if (entriesState.error !== '') {
      const hints = {
        missing: 'status.issueHint.check',
        format: 'status.issueHint.json',
        http: 'status.issueHint.http',
      };
      const hint = hints[entriesState.errorKind];
      status.update({
        message: `${entriesState.error}${hint ? ` ${t(hint)}` : ''}`,
        tone: 'error',
      });
      return;
    }
    if (warnings.length > 0) {
      const first = warnings[0];
      status.update({ message: t(first.key, first.params), tone: 'warning' });
      return;
    }
    if (entriesState.stale || entriesState.status === 'loading') {
      status.update({ message: t('status.loading'), tone: 'info' });
      return;
    }
    if (entriesState.issues.length > 0) {
      status.update({
        message: t('status.issues', {
          count: entriesState.issues.length,
          index: (entriesState.issues[0].index ?? 0) + 1,
        }),
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
    const parts = [t('count.total', { count: collection.size })];
    // Derived from the entries, so nothing has to be hand-maintained.
    const latest = collection.latestUpdatedAt() || String(collection.updatedAt ?? '').slice(0, 10);
    if (latest !== '') {
      parts.push(
        t('footer.updated', {
          label: localizedText(config.site.updatedLabel, locale, 'Updated'),
          date: latest,
        }),
      );
    }
    if (entriesState.fetchedAt && entriesState.fromCache) {
      parts.push(t('footer.cached'));
    }
    shell.footer.replaceChildren(el('p', { text: parts.join(' · ') }));
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
    setLocale,
    getLocale: () => locale,
    getTranslator: () => t,
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
 * @param {string} locale
 * @returns {{compare: (a: string, b: string) => number}} A name collator for the
 *   active language, with the other language as a tie-breaker.
 */
function createLocaleCollator(locale) {
  return createNameCollator(
    locale === 'zh' ? ['zh-Hans-CN', 'zh', 'en'] : ['en', 'zh-Hans-CN', 'zh'],
  );
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
 * Apply the language-dependent chrome: document title, `<html lang>`, the site
 * heading, the tagline and the skip link.
 *
 * @param {Record<keyof typeof SHELL, HTMLElement>} shell
 * @param {import('./config.js').AppConfig} config
 * @param {string} locale
 * @param {Document} [root]
 * @returns {void}
 */
function applyLocale(shell, config, locale, root = shell.title.ownerDocument) {
  const title = localizedText(config.site.title, locale, 'Glossary');
  const tagline = localizedText(config.site.tagline, locale, '');
  shell.title.textContent = title;
  shell.tagline.textContent = tagline;
  shell.tagline.hidden = tagline === '';
  shell.title.setAttribute('lang', localeTag(locale));
  if (root.title !== undefined) {
    root.title = title;
  }
  root.documentElement?.setAttribute('lang', localeTag(locale));
  const skip = /** @type {HTMLElement|null} */ (root.querySelector('.skip'));
  if (skip) {
    skip.textContent = locale === 'zh' ? '跳到内容' : 'Skip to content';
  }
}