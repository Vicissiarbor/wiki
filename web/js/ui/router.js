/**
 * Hash router.
 *
 * Two routes only, both usable without a server that rewrites paths:
 *
 *   #/              索引（可选 #/?q=… 表示一次搜索）
 *   #/e/<id>        某个词条的页面
 *
 * A hash router is required here: the site is published from a project
 * subdirectory and there is no way to rewrite `/ladr/e/entropy` to
 * `index.html` on that host.
 */

/** @typedef {{view: 'index'|'entry', entryId: string, query: string}} Route */

/** @type {Route} */
export const INDEX_ROUTE = Object.freeze({ view: 'index', entryId: '', query: '' });

/**
 * @param {string} hash Location hash, with or without the leading '#'.
 * @returns {Route}
 */
export function parseHash(hash) {
  const text = String(hash ?? '').replace(/^#/, '');
  if (text === '' || text === '/') {
    return { ...INDEX_ROUTE };
  }
  if (text.startsWith('/e/')) {
    const raw = text.slice(3);
    let entryId = raw;
    try {
      entryId = decodeURIComponent(raw);
    } catch {
      /* keep the raw value */
    }
    return { view: 'entry', entryId, query: '' };
  }
  const questionMark = text.indexOf('?');
  if (questionMark !== -1) {
    const params = new URLSearchParams(text.slice(questionMark + 1));
    return { view: 'index', entryId: '', query: params.get('q') ?? '' };
  }
  return { ...INDEX_ROUTE };
}

/**
 * @param {Route} route
 * @returns {string} A hash including the leading '#'.
 */
export function buildHash(route) {
  if (route.view === 'entry' && route.entryId !== '') {
    return `#/e/${encodeURIComponent(route.entryId)}`;
  }
  return route.query ? `#/?q=${encodeURIComponent(route.query)}` : '#/';
}

/**
 * @param {{onChange: (route: Route) => void, win?: Window}} options
 * @returns {{start: () => void, stop: () => void, sync: (route: Route) => void,
 *   linkFor: (route: Route) => string, absoluteLinkFor: (route: Route) => string}}
 */
export function createRouter(options) {
  const win = options.win ?? window;
  /**
   * Set only when we had to fall back to assigning `location.hash` (which fires
   * `hashchange`, unlike `history.replaceState`). It suppresses exactly one echo
   * of our own write — a stateless "did we write this value?" guess would also
   * swallow a genuine navigation back to a previously written hash.
   */
  let expectEcho = false;

  const handle = () => {
    if (expectEcho) {
      expectEcho = false;
      return;
    }
    options.onChange(parseHash(win.location.hash));
  };

  return {
    start() {
      win.addEventListener('hashchange', handle);
    },
    stop() {
      win.removeEventListener('hashchange', handle);
    },
    /**
     * Reflect the current state in the address bar.
     *
     * @param {Route} route
     */
    sync(route) {
      const current = win.location.hash;
      // Never clobber a plain in-page anchor (`#view`) the user just clicked.
      if (current !== '' && !current.startsWith('#/')) {
        return;
      }
      const hash = buildHash(route);
      if (current === hash) {
        return;
      }
      try {
        win.history.replaceState(null, '', hash);
      } catch {
        expectEcho = true;
        win.location.hash = hash;
      }
    },
    /**
     * @param {Route} route
     * @returns {string} A relative link usable inside the page.
     */
    linkFor(route) {
      return buildHash(route);
    },
    /**
     * @param {Route} route
     * @returns {string} A full URL for "copy this link" style sharing.
     */
    absoluteLinkFor(route) {
      return `${win.location.origin}${win.location.pathname}${buildHash(route)}`;
    },
  };
}