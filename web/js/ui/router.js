/**
 * Hash router: keeps the URL in sync with the current search so any view can be
 * bookmarked and shared (`…#/?q=%E7%86%B5&mode=exact&e=entropy`).
 *
 * The hash is used (instead of the path) so the site keeps working on GitHub
 * Pages project URLs (`user.github.io/repo/`) without server rewrites.
 */

/**
 * @typedef {object} Route
 * @property {string} query
 * @property {string} mode
 * @property {string} letter
 * @property {string} entryId
 */

/** @type {Route} */
export const EMPTY_ROUTE = Object.freeze({ query: '', mode: '', letter: '', entryId: '' });

/**
 * @param {string} hash Location hash, with or without the leading '#'.
 * @returns {Route}
 */
export function parseHash(hash) {
  const text = String(hash ?? '').replace(/^#/, '');
  const questionMark = text.indexOf('?');
  if (text !== '' && questionMark === -1 && !text.startsWith('/')) {
    return { ...EMPTY_ROUTE };
  }
  const params = new URLSearchParams(questionMark === -1 ? '' : text.slice(questionMark + 1));
  return {
    query: params.get('q') ?? '',
    mode: params.get('mode') ?? '',
    letter: params.get('letter') ?? '',
    entryId: params.get('e') ?? '',
  };
}

/**
 * @param {{query: string, mode: string, letter: string, entryId: string}} state
 * @returns {string} A hash (including the leading '#').
 */
export function buildHash(state) {
  const params = new URLSearchParams();
  if (state.query) {
    params.set('q', state.query);
  }
  if (state.mode) {
    params.set('mode', state.mode);
  }
  if (state.letter) {
    params.set('letter', state.letter);
  }
  if (state.entryId) {
    params.set('e', state.entryId);
  }
  const query = params.toString();
  return query === '' ? '#/' : `#/?${query}`;
}

/**
 * @param {{onChange: (route: Route) => void, win?: Window}} options
 * @returns {{start: () => void, stop: () => void, sync: (state: object) => void,
 *   buildLink: (state: object) => string}}
 */
export function createRouter(options) {
  const win = options.win ?? window;
  let lastWritten = '';

  const handle = () => {
    if (win.location.hash === lastWritten) {
      return; // Our own update: do not echo it back into the app state.
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
     * Write the current state into the URL without triggering a reload.
     *
     * @param {object} state
     */
    sync(state) {
      const hash = buildHash(state);
      if (win.location.hash === hash) {
        return;
      }
      lastWritten = hash;
      try {
        win.history.replaceState(null, '', hash);
      } catch {
        win.location.hash = hash;
      }
    },
    /**
     * @param {object} state
     * @returns {string} Absolute URL for the given state.
     */
    buildLink(state) {
      return `${win.location.origin}${win.location.pathname}${buildHash(state)}`;
    },
  };
}